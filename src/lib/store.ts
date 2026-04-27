import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "recent.json";
const MAX_RECENT = 10;

type StoreKey = "recent-folders" | "recent-topologies";

async function getStore() {
  return Store.load(STORE_FILE);
}

export async function getRecent(key: StoreKey): Promise<string[]> {
  const store = await getStore();
  return (await store.get<string[]>(key)) ?? [];
}

export async function pushRecent(key: StoreKey, value: string): Promise<void> {
  const store = await getStore();
  const existing = (await store.get<string[]>(key)) ?? [];
  const deduped = [value, ...existing.filter((v) => v !== value)].slice(
    0,
    MAX_RECENT
  );
  await store.set(key, deduped);
  await store.save();
}
