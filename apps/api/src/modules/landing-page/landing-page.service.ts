import { Injectable, NotFoundException } from '@nestjs/common';
import {
  LandingPageNavPlacement,
  LandingPageSectionKey,
  Prisma,
  type LandingPageFaq,
  type LandingPageFeature,
  type LandingPageNavItem,
  type LandingPageSection,
  type LandingPageStat,
} from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type { CreateLandingPageFaqDto } from './dto/create-faq.dto';
import type { CreateLandingPageFeatureDto } from './dto/create-feature.dto';
import type { CreateLandingPageNavItemDto } from './dto/create-nav-item.dto';
import type { CreateLandingPageStatDto } from './dto/create-stat.dto';
import type { UpdateLandingPageFaqDto } from './dto/update-faq.dto';
import type { UpdateLandingPageFeatureDto } from './dto/update-feature.dto';
import type { UpdateLandingPageNavItemDto } from './dto/update-nav-item.dto';
import type { UpdateLandingPageSectionDto } from './dto/update-section.dto';
import type { UpdateLandingPageStatDto } from './dto/update-stat.dto';

export interface AdminLandingPageContent {
  sections: LandingPageSection[];
  features: LandingPageFeature[];
  faqs: LandingPageFaq[];
  stats: LandingPageStat[];
  navItems: LandingPageNavItem[];
}

type PublicSection = Omit<LandingPageSection, 'id' | 'isActive' | 'updatedAt' | 'createdAt'>;
type PublicFeature = Omit<LandingPageFeature, 'id' | 'isActive' | 'sortOrder' | 'createdAt' | 'updatedAt'>;
type PublicFaq = Omit<LandingPageFaq, 'id' | 'isActive' | 'sortOrder' | 'createdAt' | 'updatedAt'>;
type PublicStat = Omit<LandingPageStat, 'id' | 'isActive' | 'sortOrder' | 'createdAt' | 'updatedAt'>;
type PublicNavItem = Omit<LandingPageNavItem, 'id' | 'isActive' | 'sortOrder' | 'placement' | 'createdAt' | 'updatedAt'>;

export interface PublicLandingPageContent {
  sections: PublicSection[];
  features: PublicFeature[];
  faqs: PublicFaq[];
  stats: PublicStat[];
  navItems: {
    header: PublicNavItem[];
    footerProduct: PublicNavItem[];
    footerDevelopers: PublicNavItem[];
    footerCompany: PublicNavItem[];
  };
}

const CACHE_TTL_MS = 60 * 1000; // 60s — content changes rarely; avoids a DB round trip on every landing-page view

/**
 * Backs both the public marketing landing page (read-only, active
 * content only — see getPublicContent) and the Super Admin CMS editor
 * (full read/write, including inactive rows — see getAdminContent and
 * the mutation methods below). Platform-level content: no workspaceId
 * anywhere in this file, since there is exactly one public site.
 *
 * Every mutation invalidates the short-lived in-memory public-content
 * cache immediately (same pattern as PlansService) and is recorded via
 * AuditService — see each method.
 */
@Injectable()
export class LandingPageService {
  private cache: { content: PublicLandingPageContent; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Admin (full read/write) --------------------------------------

  async getAdminContent(): Promise<AdminLandingPageContent> {
    const [sections, features, faqs, stats, navItems] = await Promise.all([
      this.prisma.landingPageSection.findMany({ orderBy: { key: 'asc' } }),
      this.prisma.landingPageFeature.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.landingPageFaq.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.landingPageStat.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.landingPageNavItem.findMany({ orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }] }),
    ]);
    return { sections, features, faqs, stats, navItems };
  }

  async updateSection(
    key: LandingPageSectionKey,
    input: UpdateLandingPageSectionDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<LandingPageSection> {
    // upsert, not update: defensive against a section key that (for
    // whatever reason — a skipped seed run, a future enum value added
    // without a backfill) has no row yet, so an admin can always create
    // it here rather than hitting a 404 with no path forward.
    const section = await this.prisma.landingPageSection.upsert({
      where: { key },
      create: { key, ...input },
      update: input,
    });

    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_section_updated',
      entity: 'LandingPageSection',
      entityId: section.id,
      userId: adminUserId,
      metadata: JSON.parse(JSON.stringify({ key, changes: input })) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return section;
  }

  // --- Features --------------------------------------------------------

  async createFeature(
    input: CreateLandingPageFeatureDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<LandingPageFeature> {
    const maxSortOrder = await this.prisma.landingPageFeature.aggregate({ _max: { sortOrder: true } });
    const feature = await this.prisma.landingPageFeature.create({
      data: { ...input, sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1 },
    });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_feature_created',
      entity: 'LandingPageFeature',
      entityId: feature.id,
      userId: adminUserId,
      metadata: { title: feature.title },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return feature;
  }

  async updateFeature(
    id: string,
    input: UpdateLandingPageFeatureDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<LandingPageFeature> {
    await this.getFeatureOrThrow(id);
    const feature = await this.prisma.landingPageFeature.update({ where: { id }, data: input });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_feature_updated',
      entity: 'LandingPageFeature',
      entityId: id,
      userId: adminUserId,
      metadata: JSON.parse(JSON.stringify({ changes: input })) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return feature;
  }

  async deleteFeature(id: string, adminUserId: string, ctx: RequestContext): Promise<void> {
    const existing = await this.getFeatureOrThrow(id);
    await this.prisma.landingPageFeature.delete({ where: { id } });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_feature_deleted',
      entity: 'LandingPageFeature',
      entityId: id,
      userId: adminUserId,
      metadata: { title: existing.title },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async reorderFeatures(orderedIds: string[], adminUserId: string, ctx: RequestContext): Promise<void> {
    await this.reorder(this.prisma.landingPageFeature, orderedIds);
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_feature_reordered',
      entity: 'LandingPageFeature',
      userId: adminUserId,
      metadata: { orderedIds },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private async getFeatureOrThrow(id: string): Promise<LandingPageFeature> {
    const feature = await this.prisma.landingPageFeature.findUnique({ where: { id } });
    if (!feature) throw new NotFoundException('Feature not found');
    return feature;
  }

  // --- FAQs --------------------------------------------------------

  async createFaq(input: CreateLandingPageFaqDto, adminUserId: string, ctx: RequestContext): Promise<LandingPageFaq> {
    const maxSortOrder = await this.prisma.landingPageFaq.aggregate({ _max: { sortOrder: true } });
    const faq = await this.prisma.landingPageFaq.create({
      data: { ...input, sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1 },
    });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_faq_created',
      entity: 'LandingPageFaq',
      entityId: faq.id,
      userId: adminUserId,
      metadata: { question: faq.question },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return faq;
  }

  async updateFaq(
    id: string,
    input: UpdateLandingPageFaqDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<LandingPageFaq> {
    await this.getFaqOrThrow(id);
    const faq = await this.prisma.landingPageFaq.update({ where: { id }, data: input });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_faq_updated',
      entity: 'LandingPageFaq',
      entityId: id,
      userId: adminUserId,
      metadata: JSON.parse(JSON.stringify({ changes: input })) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return faq;
  }

  async deleteFaq(id: string, adminUserId: string, ctx: RequestContext): Promise<void> {
    const existing = await this.getFaqOrThrow(id);
    await this.prisma.landingPageFaq.delete({ where: { id } });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_faq_deleted',
      entity: 'LandingPageFaq',
      entityId: id,
      userId: adminUserId,
      metadata: { question: existing.question },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async reorderFaqs(orderedIds: string[], adminUserId: string, ctx: RequestContext): Promise<void> {
    await this.reorder(this.prisma.landingPageFaq, orderedIds);
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_faq_reordered',
      entity: 'LandingPageFaq',
      userId: adminUserId,
      metadata: { orderedIds },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private async getFaqOrThrow(id: string): Promise<LandingPageFaq> {
    const faq = await this.prisma.landingPageFaq.findUnique({ where: { id } });
    if (!faq) throw new NotFoundException('FAQ not found');
    return faq;
  }

  // --- Stats --------------------------------------------------------

  async createStat(
    input: CreateLandingPageStatDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<LandingPageStat> {
    const maxSortOrder = await this.prisma.landingPageStat.aggregate({ _max: { sortOrder: true } });
    const stat = await this.prisma.landingPageStat.create({
      data: { ...input, sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1 },
    });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_stat_created',
      entity: 'LandingPageStat',
      entityId: stat.id,
      userId: adminUserId,
      metadata: { label: stat.label },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return stat;
  }

  async updateStat(
    id: string,
    input: UpdateLandingPageStatDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<LandingPageStat> {
    await this.getStatOrThrow(id);
    const stat = await this.prisma.landingPageStat.update({ where: { id }, data: input });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_stat_updated',
      entity: 'LandingPageStat',
      entityId: id,
      userId: adminUserId,
      metadata: JSON.parse(JSON.stringify({ changes: input })) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return stat;
  }

  async deleteStat(id: string, adminUserId: string, ctx: RequestContext): Promise<void> {
    const existing = await this.getStatOrThrow(id);
    await this.prisma.landingPageStat.delete({ where: { id } });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_stat_deleted',
      entity: 'LandingPageStat',
      entityId: id,
      userId: adminUserId,
      metadata: { label: existing.label },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async reorderStats(orderedIds: string[], adminUserId: string, ctx: RequestContext): Promise<void> {
    await this.reorder(this.prisma.landingPageStat, orderedIds);
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_stat_reordered',
      entity: 'LandingPageStat',
      userId: adminUserId,
      metadata: { orderedIds },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private async getStatOrThrow(id: string): Promise<LandingPageStat> {
    const stat = await this.prisma.landingPageStat.findUnique({ where: { id } });
    if (!stat) throw new NotFoundException('Stat not found');
    return stat;
  }

  // --- Nav items --------------------------------------------------------

  async createNavItem(
    input: CreateLandingPageNavItemDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<LandingPageNavItem> {
    const maxSortOrder = await this.prisma.landingPageNavItem.aggregate({
      where: { placement: input.placement },
      _max: { sortOrder: true },
    });
    const navItem = await this.prisma.landingPageNavItem.create({
      data: { ...input, sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1 },
    });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_nav_item_created',
      entity: 'LandingPageNavItem',
      entityId: navItem.id,
      userId: adminUserId,
      metadata: { label: navItem.label, placement: navItem.placement },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return navItem;
  }

  async updateNavItem(
    id: string,
    input: UpdateLandingPageNavItemDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<LandingPageNavItem> {
    await this.getNavItemOrThrow(id);
    const navItem = await this.prisma.landingPageNavItem.update({ where: { id }, data: input });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_nav_item_updated',
      entity: 'LandingPageNavItem',
      entityId: id,
      userId: adminUserId,
      metadata: JSON.parse(JSON.stringify({ changes: input })) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return navItem;
  }

  async deleteNavItem(id: string, adminUserId: string, ctx: RequestContext): Promise<void> {
    const existing = await this.getNavItemOrThrow(id);
    await this.prisma.landingPageNavItem.delete({ where: { id } });
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_nav_item_deleted',
      entity: 'LandingPageNavItem',
      entityId: id,
      userId: adminUserId,
      metadata: { label: existing.label, placement: existing.placement },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async reorderNavItems(orderedIds: string[], adminUserId: string, ctx: RequestContext): Promise<void> {
    await this.reorder(this.prisma.landingPageNavItem, orderedIds);
    this.cache = null;
    await this.audit.record({
      action: 'admin.landing_page_nav_item_reordered',
      entity: 'LandingPageNavItem',
      userId: adminUserId,
      metadata: { orderedIds },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private async getNavItemOrThrow(id: string): Promise<LandingPageNavItem> {
    const navItem = await this.prisma.landingPageNavItem.findUnique({ where: { id } });
    if (!navItem) throw new NotFoundException('Navigation item not found');
    return navItem;
  }

  /** Shared reorder implementation — sortOrder is reassigned
   * sequentially (0, 1, 2, ...) from the given id order. Only ever
   * called with `this.prisma.<model>` as `delegate`, all four of which
   * share the same `{ sortOrder: number }` update shape. */
  private async reorder(
    delegate: {
      updateMany: (args: {
        where: { id: string };
        data: { sortOrder: number };
      }) => Prisma.PrismaPromise<Prisma.BatchPayload>;
    },
    orderedIds: string[],
  ): Promise<void> {
    await this.prisma.$transaction(
      orderedIds.map((id, index) => delegate.updateMany({ where: { id }, data: { sortOrder: index } })),
    );
  }

  // --- Public (active content only, cached) --------------------------------------

  async getPublicContent(): Promise<PublicLandingPageContent> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.content;
    }

    const [sections, features, faqs, stats, navItems] = await Promise.all([
      this.prisma.landingPageSection.findMany({ where: { isActive: true } }),
      this.prisma.landingPageFeature.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.landingPageFaq.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.landingPageStat.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.landingPageNavItem.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);

    const stripSection = ({ id: _id, isActive: _isActive, updatedAt: _updatedAt, createdAt: _createdAt, ...rest }: LandingPageSection): PublicSection => rest;
    const stripFeature = ({ id: _id, isActive: _isActive, sortOrder: _sortOrder, createdAt: _createdAt, updatedAt: _updatedAt, ...rest }: LandingPageFeature): PublicFeature => rest;
    const stripFaq = ({ id: _id, isActive: _isActive, sortOrder: _sortOrder, createdAt: _createdAt, updatedAt: _updatedAt, ...rest }: LandingPageFaq): PublicFaq => rest;
    const stripStat = ({ id: _id, isActive: _isActive, sortOrder: _sortOrder, createdAt: _createdAt, updatedAt: _updatedAt, ...rest }: LandingPageStat): PublicStat => rest;
    const stripNavItem = ({ id: _id, isActive: _isActive, sortOrder: _sortOrder, placement: _placement, createdAt: _createdAt, updatedAt: _updatedAt, ...rest }: LandingPageNavItem): PublicNavItem => rest;

    const content: PublicLandingPageContent = {
      sections: sections.map(stripSection),
      features: features.map(stripFeature),
      faqs: faqs.map(stripFaq),
      stats: stats.map(stripStat),
      navItems: {
        header: navItems.filter((n) => n.placement === LandingPageNavPlacement.HEADER).map(stripNavItem),
        footerProduct: navItems.filter((n) => n.placement === LandingPageNavPlacement.FOOTER_PRODUCT).map(stripNavItem),
        footerDevelopers: navItems.filter((n) => n.placement === LandingPageNavPlacement.FOOTER_DEVELOPERS).map(stripNavItem),
        footerCompany: navItems.filter((n) => n.placement === LandingPageNavPlacement.FOOTER_COMPANY).map(stripNavItem),
      },
    };

    this.cache = { content, expiresAt: now + CACHE_TTL_MS };
    return content;
  }
}
