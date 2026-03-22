/**
 * admin.ts — Admin API handlers
 */

import {
  getData,
  getUsageWeek,
  getDailyLimit,
  getUsageToday,
  resetUsageToday,
  addChild,
  removeChild,
  saveStore,
  Child,
} from "./store.ts";

export function handleAdminStats(): Response {
  const data = getData();
  const children = data.children.map((child) => {
    const usedToday = getUsageToday(child.id);
    const limit = getDailyLimit(child.id);
    const weekUsage = getUsageWeek(child.id);
    return {
      id: child.id,
      name: child.name,
      daily_limit_seconds: limit,
      today: {
        used: usedToday,
        limit,
        remaining: Math.max(0, limit - usedToday),
      },
      week: weekUsage,
    };
  });
  return json({ children });
}

export async function handleCreateChild(req: Request): Promise<Response> {
  let body: Partial<Child>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { name, pin, daily_limit_seconds } = body;
  if (!name || !pin) {
    return json({ error: "name and pin are required" }, 400);
  }
  if (!/^\d{4,6}$/.test(pin)) {
    return json({ error: "pin must be 4-6 digits" }, 400);
  }

  const data = getData();

  // Check pin uniqueness (skip for admin pin - separate check)
  const pinConflict = data.children.find((c) => c.pin === pin && c.id !== body.id);
  if (pinConflict) {
    return json({ error: "PIN already in use" }, 409);
  }

  const id: string = body.id || `child_${Date.now()}`;
  const child: Child = {
    id,
    name: String(name),
    pin: String(pin),
    daily_limit_seconds: Number(daily_limit_seconds ?? data.daily_limit_seconds),
  };

  addChild(child);
  await saveStore();
  return json({ ok: true, child });
}

export async function handleDeleteChild(id: string): Promise<Response> {
  const removed = removeChild(id);
  if (!removed) {
    return json({ error: "Child not found" }, 404);
  }
  await saveStore();
  return json({ ok: true });
}

export async function handleResetQuota(id: string): Promise<Response> {
  const data = getData();
  const child = data.children.find((c) => c.id === id);
  if (!child) {
    return json({ error: "Child not found" }, 404);
  }
  resetUsageToday(id);
  await saveStore();
  return json({ ok: true });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
