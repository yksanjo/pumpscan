import {
  disableAlertSubscriber,
  listEnabledAlertSubscribers,
  updateAlertSubscriber,
} from "./alert-subscribers";
import type { BreakoutSignal } from "./breakout-alerts";
import type { NewTokenAlert } from "./new-token-scanner";
import { checkSoagAlertAccess, formatSoagAmount } from "./soag-access";
import {
  formatBreakoutTelegramAlert,
  formatNewTokenTelegramAlert,
  sendTelegramMessage,
} from "./telegram-alerts";

const DEFAULT_REVERIFY_MS = 24 * 60 * 60 * 1000;

function reverifyIntervalMs(): number {
  const raw = Number(process.env.SOAG_ALERT_REVERIFY_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REVERIFY_MS;
}

function shouldReverify(lastVerifiedAt: string): boolean {
  const then = new Date(lastVerifiedAt).getTime();
  if (!Number.isFinite(then)) return true;
  return Date.now() - then >= reverifyIntervalMs();
}

export async function deliverAlertToEligibleTelegramSubscribers(
  alert: NewTokenAlert
): Promise<{ attempted: number; sent: number; disabled: number }> {
  return deliverTelegramMessageToEligibleSubscribers(formatNewTokenTelegramAlert(alert));
}

export async function deliverBreakoutAlertToEligibleTelegramSubscribers(
  signal: BreakoutSignal
): Promise<{ attempted: number; sent: number; disabled: number }> {
  return deliverTelegramMessageToEligibleSubscribers(formatBreakoutTelegramAlert(signal));
}

async function deliverTelegramMessageToEligibleSubscribers(
  message: string
): Promise<{ attempted: number; sent: number; disabled: number }> {
  const subscribers = await listEnabledAlertSubscribers();
  const deliveredChats = new Set<string>();
  let sent = 0;
  let disabled = 0;

  for (const subscriber of subscribers) {
    if (deliveredChats.has(subscriber.telegramId)) continue;

    if (shouldReverify(subscriber.lastVerifiedAt)) {
      try {
        const access = await checkSoagAlertAccess(subscriber.wallet);
        if (!access.eligible) {
          await disableAlertSubscriber(
            subscriber.wallet,
            `SOAG balance dropped below ${formatSoagAmount(access.required)}`
          );
          disabled += 1;
          continue;
        }
        await updateAlertSubscriber(subscriber.wallet, {
          soagBalance: access.balance,
          lastVerifiedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error(
          `[Alerts] Reverification failed for ${subscriber.wallet.slice(0, 8)}...:`,
          err
        );
      }
    }

    try {
      await sendTelegramMessage(subscriber.telegramId, message);
      deliveredChats.add(subscriber.telegramId);
      sent += 1;
      await updateAlertSubscriber(subscriber.wallet, {
        lastAlertAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(
        `[Alerts] Telegram delivery failed for ${subscriber.telegramId}:`,
        err
      );
    }
  }

  return {
    attempted: subscribers.length,
    sent,
    disabled,
  };
}
