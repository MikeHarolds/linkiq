import type { ClassifiedReferrer } from './referrer-classifier';

export type AttributionType = 'campaign' | 'utm' | 'referrer' | 'direct';

export interface AttributionResult {
  linkSourceId: string | null;
  attributedSource: string | null;
  attributedMedium: string | null;
  attributedCampaign: string | null;
  attributionType: AttributionType;
}

/** The subset of a matched LinkSource row the resolver actually needs —
 * kept narrow so callers can `select` just these columns rather than
 * fetching the whole row. */
export interface MatchedLinkSource {
  id: string;
  source: string;
  medium: string;
  campaign: string | null;
}

/**
 * Explicit Link Source / Campaign Attribution — the priority cascade:
 *
 *   1. Explicit LinkIQ tracking source (an active LinkSource matching
 *      the incoming utm_source, looked up by the caller — see
 *      ClickEventProcessor)
 *   2. Plain UTM (utm_source present, but matching no active LinkSource
 *      for this link)
 *   3. HTTP Referer (Sprint 13's classifyReferrer — always computed by
 *      the caller regardless of this resolver's outcome, untouched)
 *   4. Direct
 *
 * Pure and synchronous by design — the only I/O (finding a matching
 * LinkSource) happens in the caller, so this function is fully unit
 * testable without a database. Exists specifically because some
 * originating platforms (WhatsApp's mobile app; Facebook's in-app
 * browser for organic message shares) are well-documented to strip the
 * Referer header entirely — an explicit, Referer-independent source is
 * the only way to attribute that traffic reliably.
 */
export function resolveAttribution(
  matchedSource: MatchedLinkSource | null,
  queryParams: Record<string, string> | null,
  referrer: ClassifiedReferrer,
): AttributionResult {
  if (matchedSource) {
    return {
      linkSourceId: matchedSource.id,
      attributedSource: matchedSource.source,
      attributedMedium: matchedSource.medium,
      attributedCampaign: matchedSource.campaign,
      attributionType: 'campaign',
    };
  }

  const rawSource = queryParams?.utm_source;
  if (rawSource) {
    return {
      linkSourceId: null,
      attributedSource: rawSource,
      attributedMedium: queryParams?.utm_medium ?? null,
      attributedCampaign: queryParams?.utm_campaign ?? null,
      attributionType: 'utm',
    };
  }

  if (referrer.category !== 'direct') {
    return {
      linkSourceId: null,
      attributedSource: referrer.domain,
      attributedMedium: referrer.category,
      attributedCampaign: null,
      attributionType: 'referrer',
    };
  }

  return {
    linkSourceId: null,
    attributedSource: null,
    attributedMedium: null,
    attributedCampaign: null,
    attributionType: 'direct',
  };
}
