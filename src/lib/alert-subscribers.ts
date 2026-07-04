import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AlertSubscriber {
  wallet: string;
  telegramId: string;
  soagBalance: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string;
  lastAlertAt?: string;
  disabledReason?: string;
}

interface SubscriberStore {
  version: 1;
  subscribers: AlertSubscriber[];
}

const DEFAULT_ALERT_SUBSCRIBERS_FILE = "data/alert-subscribers.json";

const EMPTY_STORE: SubscriberStore = { version: 1, subscribers: [] };

async function readStore(): Promise<SubscriberStore> {
  try {
    const raw = await readFile(
      /* turbopackIgnore: true */ alertSubscribersFile(),
      "utf8"
    );
    const parsed = JSON.parse(raw) as Partial<SubscriberStore>;
    return {
      version: 1,
      subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : [],
    };
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return EMPTY_STORE;
    }
    throw err;
  }
}

async function writeStore(store: SubscriberStore): Promise<void> {
  const file = alertSubscribersFile();
  await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    /* turbopackIgnore: true */ tmp,
    `${JSON.stringify(store, null, 2)}\n`,
    "utf8"
  );
  await rename(/* turbopackIgnore: true */ tmp, file);
}

function alertSubscribersFile(): string {
  return process.env.ALERT_SUBSCRIBERS_FILE || DEFAULT_ALERT_SUBSCRIBERS_FILE;
}

export async function upsertAlertSubscriber(input: {
  wallet: string;
  telegramId: string;
  soagBalance: number;
}): Promise<AlertSubscriber> {
  const store = await readStore();
  const now = new Date().toISOString();
  const existing = store.subscribers.find((sub) => sub.wallet === input.wallet);

  const subscriber: AlertSubscriber = {
    wallet: input.wallet,
    telegramId: input.telegramId,
    soagBalance: input.soagBalance,
    enabled: true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastVerifiedAt: now,
  };

  if (existing) {
    Object.assign(existing, subscriber);
  } else {
    store.subscribers.push(subscriber);
  }

  await writeStore(store);
  return subscriber;
}

export async function listEnabledAlertSubscribers(): Promise<AlertSubscriber[]> {
  const store = await readStore();
  return store.subscribers.filter((sub) => sub.enabled);
}

export async function updateAlertSubscriber(
  wallet: string,
  patch: Partial<Omit<AlertSubscriber, "wallet" | "createdAt">>
): Promise<AlertSubscriber | null> {
  const store = await readStore();
  const subscriber = store.subscribers.find((sub) => sub.wallet === wallet);
  if (!subscriber) return null;

  Object.assign(subscriber, {
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  await writeStore(store);
  return subscriber;
}

export async function disableAlertSubscriber(
  wallet: string,
  disabledReason: string
): Promise<AlertSubscriber | null> {
  return updateAlertSubscriber(wallet, {
    enabled: false,
    disabledReason,
  });
}
