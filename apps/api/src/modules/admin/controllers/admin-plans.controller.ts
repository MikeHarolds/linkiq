import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../../common/decorators/request-context.decorator';
import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { PlansService, type PlanWithLimits } from '../../billing/plans.service';
import { BILLING_PROVIDER, type BillingProvider } from '../../billing/providers/billing-provider.interface';
import { CurrencyService } from '../../currency/currency.service';
import { ExchangeRateService } from '../../currency/exchange-rate/exchange-rate.service';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { SetPlanPriceDto } from '../dto/set-plan-price.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';

/**
 * Sprint 16 — unlike the customer-facing `planResponse()` in
 * billing.controller.ts (which deliberately omits providerPlanId/
 * platformRole — internal wiring details a workspace member doesn't
 * need), the admin plan catalog needs the FULL raw Plan row (Paystack
 * plan_code, attached role, ...) — this only reshapes `prices` into
 * the flat, currency-aware DTO shape the admin UI's PlanPricesTable
 * expects (see packages/types PlanPriceDto), never strips a field the
 * pre-Sprint-16 raw-Prisma-object response already exposed.
 */
function toAdminPlanDto(plan: PlanWithLimits, providerCurrencies: string[] | undefined) {
  return {
    ...plan,
    prices: plan.prices.map((p) => ({
      currencyCode: p.currency.code,
      amount: p.amount,
      isConverted: p.isConverted,
      providerAvailable: !providerCurrencies || providerCurrencies.includes(p.currency.code),
    })),
    providerAvailable: !providerCurrencies || providerCurrencies.includes(plan.currency),
  };
}

/**
 * Platform plan catalog management — SUPER_ADMIN only.
 *
 * Create/update only — deliberately no hard-delete endpoint. A Plan
 * that has ever had a subscription cannot be hard-deleted anyway
 * (Subscription.planId has no onDelete clause, so Postgres defaults to
 * RESTRICT — see schema.prisma), and even a never-subscribed plan
 * would be inconsistent with the rest of this catalog's design
 * (immutable slug, PlanLimit cascading). "Archive" a plan by
 * deactivating it via PATCH { isActive: false } — the same operation
 * already used to hide a plan from new checkouts, which is the only
 * safe "remove" semantics a live billing system supports without
 * corrupting historical Invoice/Subscription records.
 */
@ApiTags('admin-plans')
@ApiBearerAuth()
@Controller('admin/plans')
@UseGuards(SuperAdminGuard)
export class AdminPlansController {
  private readonly logger = new Logger(AdminPlansController.name);

  constructor(
    private readonly plans: PlansService,
    @Inject(BILLING_PROVIDER) private readonly billingProvider: BillingProvider,
    private readonly exchangeRates: ExchangeRateService,
    private readonly currencies: CurrencyService,
  ) {}

  private get providerCurrencies(): string[] | undefined {
    return this.billingProvider.getSupportedCurrencies?.();
  }

  @Get()
  @ApiOperation({
    summary: 'List every plan, including inactive ones (SUPER_ADMIN only)',
  })
  @ApiResponse({ status: 200, description: 'Full plan catalog with limits' })
  async list() {
    const plans = await this.plans.listAllForAdmin();
    return plans.map((plan) => toAdminPlanDto(plan, this.providerCurrencies));
  }

  @Get(':planId')
  @ApiOperation({ summary: 'View a single plan' })
  async getOne(@Param('planId') planId: string) {
    const plan = await this.plans.getByIdOrThrow(planId);
    return toAdminPlanDto(plan, this.providerCurrencies);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new plan, optionally syncing it to the active payment provider',
  })
  async create(
    @Body() dto: CreatePlanDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    const { syncToProvider, ...createInput } = dto;
    let plan = await this.plans.create(createInput, admin.id, ctx);

    // Best-effort, never fails plan creation: LinkIQ's own Plan row is
    // the thing that must exist regardless of whether the provider
    // call succeeds — see BillingProvider.createProviderPlan's docs.
    if (syncToProvider && this.billingProvider.createProviderPlan) {
      try {
        const result = await this.billingProvider.createProviderPlan({
          name: plan.name,
          priceAmount: plan.priceAmount,
          currency: plan.currency,
          billingInterval: plan.billingInterval,
        });
        plan = await this.plans.updateForAdmin(
          plan.id,
          { providerPlanId: result.providerPlanId },
          admin.id,
          ctx,
        );
      } catch (error) {
        this.logger.warn(
          `Provider plan sync failed for new plan "${plan.slug}" — created locally without a providerPlanId: ${String(error)}`,
        );
      }
    }

    return toAdminPlanDto(plan, this.providerCurrencies);
  }

  @Patch(':planId')
  @ApiOperation({
    summary: 'Update a plan (price, limits, trial, active status, ...)',
  })
  async update(
    @Param('planId') planId: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    const plan = await this.plans.updateForAdmin(planId, dto, admin.id, ctx);
    return toAdminPlanDto(plan, this.providerCurrencies);
  }

  /**
   * Sprint 16 — sets (or replaces) this plan's price in a specific
   * currency. `useExchangeRate: true` derives `amount` from the plan's
   * OWN base price via ExchangeRateService.convert() instead of the
   * caller supplying one directly — returns 400 with a clear message
   * when no exchange rate is available (NullExchangeRateProvider today
   * — see that provider's own docs), never silently falls back to a
   * fixed price the admin didn't actually type in. `syncToProvider`
   * mirrors `create()`'s own best-effort provider-plan sync, scoped to
   * this one currency's Paystack plan_code.
   */
  @Post(':planId/prices')
  @ApiOperation({ summary: "Set a plan's price in a specific currency" })
  async setPrice(
    @Param('planId') planId: string,
    @Body() dto: SetPlanPriceDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    const plan = await this.plans.getByIdOrThrow(planId);

    let amount = dto.amount;
    let exchangeRate: number | null = null;
    let exchangeRateAsOf: Date | null = null;

    if (dto.useExchangeRate) {
      const targetCurrency = await this.currencies.getByIdOrThrow(dto.currencyId);
      const conversion = await this.exchangeRates.convert(
        plan.priceAmount,
        plan.currency,
        targetCurrency.code,
      );
      if (!conversion) {
        throw new BadRequestException(
          `No exchange rate is available to convert ${plan.currency} to ${targetCurrency.code} — set a fixed amount instead.`,
        );
      }
      amount = conversion.amount;
      exchangeRate = conversion.rate;
      exchangeRateAsOf = conversion.timestamp;
    } else if (amount === undefined) {
      throw new BadRequestException('amount is required unless useExchangeRate is true');
    }

    let updatedPlan = await this.plans.setPrice(
      planId,
      {
        currencyId: dto.currencyId,
        amount: amount!,
        isConverted: dto.useExchangeRate ?? false,
        exchangeRate,
        exchangeRateAsOf,
        providerPlanId: dto.providerPlanId,
      },
      admin.id,
      ctx,
    );

    if (dto.syncToProvider && this.billingProvider.createProviderPlan) {
      const price = updatedPlan.prices.find((p) => p.currencyId === dto.currencyId);
      if (price) {
        try {
          const result = await this.billingProvider.createProviderPlan({
            name: updatedPlan.name,
            priceAmount: price.amount,
            currency: price.currency.code,
            billingInterval: updatedPlan.billingInterval,
          });
          updatedPlan = await this.plans.setPrice(
            planId,
            {
              currencyId: dto.currencyId,
              amount: price.amount,
              isConverted: price.isConverted,
              exchangeRate: price.exchangeRate ? Number(price.exchangeRate) : null,
              exchangeRateAsOf: price.exchangeRateAsOf,
              providerPlanId: result.providerPlanId,
            },
            admin.id,
            ctx,
          );
        } catch (error) {
          this.logger.warn(
            `Provider plan sync failed for "${updatedPlan.slug}" in ${price.currency.code} — price saved locally without a providerPlanId: ${String(error)}`,
          );
        }
      }
    }

    return toAdminPlanDto(updatedPlan, this.providerCurrencies);
  }

  @Delete(':planId/prices/:currencyId')
  @ApiOperation({ summary: "Remove a plan's price in a specific currency" })
  async removePrice(
    @Param('planId') planId: string,
    @Param('currencyId') currencyId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    const plan = await this.plans.removePrice(planId, currencyId, admin.id, ctx);
    return toAdminPlanDto(plan, this.providerCurrencies);
  }
}
