/**
 * Mirror Marketplace — trade access to top trading mirrors and journals.
 *
 * The innovation:
 *   Top traders can "mint" their Mirror Pilot as an NFT.
 *   Other users can buy/subscribe to access their trade theses in real-time.
 *   It's like Patreon + OnlyFans + Substack for on-chain trading alpha.
 *
 * No one has done this because:
 *   - Requires real-time wallet mirroring (Mirror Pilot)
 *   - Requires AI-generated trade theses (Journal Copilot)
 *   - Requires on-chain verification of trading performance
 *   - Combines social + DeFi + AI in a way that's never been assembled
 *
 * Revenue model:
 *   - Creators set subscription price (e.g., 0.1 SOL/month)
 *   - Platform takes 5% fee
 *   - Payments in SOL, auto-distributed weekly
 */

import { MirrorPilot, type MirrorProfile, type TradeThesis } from "./mirror-pilot";
import { JournalCopilot, type JournalEntry, type JournalStats } from "./journal-copilot";

// ============================================================
// TYPES
// ============================================================

export type SubscriptionTier = "free" | "basic" | "premium" | "whale";

export interface MirrorListing {
  id: string;
  wallet: string;
  username: string;
  bio: string;
  avatar: string;
  
  // Pricing
  tiers: Array<{
    tier: SubscriptionTier;
    priceSol: number;
    benefits: string[];
  }>;
  
  // Performance
  stats: {
    totalTrades: number;
    winRate: number;
    avgReturnPerTrade: number;
    totalPnlSol: number;
    followers: number;
    avgRating: number;
  };
  
  // Verification
  verified: boolean;
  totalVolumeSol: number;
  createdAt: number;
  
  // Preview (limited free data)
  recentTheses: TradeThesis[];
}

export interface Subscription {
  id: string;
  subscriberWallet: string;
  creatorWallet: string;
  creatorUsername: string;
  tier: SubscriptionTier;
  priceSol: number;
  startDate: number;
  endDate: number;
  active: boolean;
  autoRenew: boolean;
}

export interface MarketplaceStats {
  totalListings: number;
  totalSubscriptions: number;
  totalVolumeSol: number;
  topCreators: MirrorListing[];
  recentListings: MirrorListing[];
}

// ============================================================
// MARKETPLACE ENGINE
// ============================================================

export class MirrorMarketplace {
  private listings: Map<string, MirrorListing> = new Map();
  private subscriptions: Map<string, Subscription[]> = new Map();
  private platformFee = 0.05; // 5%

  /**
   * List a mirror on the marketplace
   */
  async listMirror(
    wallet: string,
    username: string,
    bio: string,
    tiers: MirrorListing["tiers"]
  ): Promise<MirrorListing> {
    const mirror = new MirrorPilot(wallet);
    const profile = await mirror.initialize();

    // Calculate performance stats
    const feed = mirror.getFeed(100);
    const totalTrades = feed.length;
    const winRate = profile.stats.winRate;

    const listing: MirrorListing = {
      id: `mirror_${wallet}`,
      wallet,
      username,
      bio,
      avatar: profile.avatar,
      tiers,
      stats: {
        totalTrades,
        winRate,
        avgReturnPerTrade: 0,
        totalPnlSol: 0,
        followers: 0,
        avgRating: 0,
      },
      verified: totalTrades > 50 && winRate > 40,
      totalVolumeSol: 0,
      createdAt: Date.now(),
      recentTheses: profile.recentTheses.slice(0, 3),
    };

    this.listings.set(listing.id, listing);
    return listing;
  }

  /**
   * Subscribe to a mirror
   */
  async subscribe(
    subscriberWallet: string,
    creatorWallet: string,
    tier: SubscriptionTier
  ): Promise<Subscription> {
    const listing = Array.from(this.listings.values()).find(
      (l) => l.wallet === creatorWallet
    );
    if (!listing) throw new Error("Creator not found");

    const tierConfig = listing.tiers.find((t) => t.tier === tier);
    if (!tierConfig) throw new Error("Tier not found");

    const subscription: Subscription = {
      id: `sub_${subscriberWallet}_${creatorWallet}_${Date.now()}`,
      subscriberWallet,
      creatorWallet,
      creatorUsername: listing.username,
      tier,
      priceSol: tierConfig.priceSol,
      startDate: Date.now(),
      endDate: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
      active: true,
      autoRenew: true,
    };

    const userSubs = this.subscriptions.get(subscriberWallet) ?? [];
    userSubs.push(subscription);
    this.subscriptions.set(subscriberWallet, userSubs);

    // Update stats
    listing.stats.followers++;
    listing.totalVolumeSol += tierConfig.priceSol;

    return subscription;
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    for (const [, subs] of this.subscriptions) {
      const sub = subs.find((s) => s.id === subscriptionId);
      if (sub) {
        sub.active = false;
        sub.autoRenew = false;
        return;
      }
    }
  }

  /**
   * Get all listings
   */
  getListings(filter?: {
    minWinRate?: number;
    minTrades?: number;
    verified?: boolean;
    sortBy?: "popular" | "newest" | "winRate";
  }): MirrorListing[] {
    let results = Array.from(this.listings.values());

    if (filter?.minWinRate) {
      results = results.filter((l) => l.stats.winRate >= filter.minWinRate!);
    }
    if (filter?.minTrades) {
      results = results.filter((l) => l.stats.totalTrades >= filter.minTrades!);
    }
    if (filter?.verified) {
      results = results.filter((l) => l.verified);
    }

    if (filter?.sortBy === "popular") {
      results.sort((a, b) => b.stats.followers - a.stats.followers);
    } else if (filter?.sortBy === "winRate") {
      results.sort((a, b) => b.stats.winRate - a.stats.winRate);
    } else {
      results.sort((a, b) => b.createdAt - a.createdAt);
    }

    return results;
  }

  /**
   * Get user's subscriptions
   */
  getUserSubscriptions(wallet: string): Subscription[] {
    return (this.subscriptions.get(wallet) ?? []).filter((s) => s.active);
  }

  /**
   * Get marketplace stats
   */
  getStats(): MarketplaceStats {
    const allListings = Array.from(this.listings.values());
    const allSubs = Array.from(this.subscriptions.values()).flat();
    const totalVolume = allListings.reduce((s, l) => s + l.totalVolumeSol, 0);

    return {
      totalListings: allListings.length,
      totalSubscriptions: allSubs.filter((s) => s.active).length,
      totalVolumeSol: Math.round(totalVolume * 1000) / 1000,
      topCreators: [...allListings]
        .sort((a, b) => b.stats.followers - a.stats.followers)
        .slice(0, 10),
      recentListings: [...allListings]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 10),
    };
  }

  /**
   * Calculate platform revenue
   */
  getPlatformRevenue(): { totalVolume: number; fees: number } {
    const totalVolume = Array.from(this.listings.values()).reduce(
      (s, l) => s + l.totalVolumeSol,
      0
    );
    return {
      totalVolume,
      fees: Math.round(totalVolume * this.platformFee * 1000) / 1000,
    };
  }
}

/**
 * Generate a shareable profile card for a mirror listing
 */
export function generateProfileCard(listing: MirrorListing): string {
  const verifiedBadge = listing.verified ? " ✅ VERIFIED" : "";
  const lines: string[] = [];

  lines.push(`╔══════════════════════════════════════════════╗`);
  lines.push(`║         Mirror Pilot Profile Card           ║`);
  lines.push(`╚══════════════════════════════════════════════╝`);
  lines.push(``);
  lines.push(`  ${listing.username}${verifiedBadge}`);
  lines.push(`  ${listing.bio}`);
  lines.push(``);
  lines.push(`  📊 Performance`);
  lines.push(`     Trades: ${listing.stats.totalTrades}`);
  lines.push(`     Win Rate: ${listing.stats.winRate}%`);
  lines.push(`     Followers: ${listing.stats.followers}`);
  lines.push(`     Volume: ${listing.totalVolumeSol} SOL`);
  lines.push(``);
  lines.push(`  💎 Subscription Tiers`);
  for (const tier of listing.tiers) {
    lines.push(`     ${tier.tier.toUpperCase()}: ${tier.priceSol} SOL/month`);
    for (const benefit of tier.benefits) {
      lines.push(`       • ${benefit}`);
    }
  }
  lines.push(``);
  lines.push(`  🔍 Recent Theses`);
  for (const thesis of listing.recentTheses.slice(0, 3)) {
    lines.push(`     • ${thesis.trade.tokenSymbol}: ${thesis.reasoning.slice(0, 80)}...`);
  }

  return lines.join("\n");
}
