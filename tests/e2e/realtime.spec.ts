import { expect, test } from "./fixtures";
import { caseIdOf, messages, waitForRealtime } from "./helpers";
import { startStreamProxy } from "./stream-proxy";

test("changes made before the first live connection succeeds are picked up, without reloading", async ({ signIn }) => {
  const carter = await caseIdOf("Carter");
  const viewer = await signIn("smith@riverside.demo");

  // The viewer's first realtime connection fails; the retry is held back until we release it.
  let attempts = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await viewer.route(/\/api\/cases\/[^/]+\/events$/, async (route) => {
    attempts += 1;
    if (attempts === 1) return route.abort("connectionreset");
    await held;
    await route.continue();
  });
  try {
    await viewer.goto(`/cases/${carter}/discussion`);
    await expect(viewer.getByTitle("Reconnecting…")).toBeVisible();
    await expect.poll(() => attempts).toBeGreaterThan(1);

    const author = await signIn("nguyen@riverside.demo");
    await author.goto(`/cases/${carter}/discussion`);
    const text = `Posted before Dr. Smith's first live connection (e2e ${Date.now()})`;
    await author.getByPlaceholder(/Message the care team/).fill(text);
    await author.getByRole("button", { name: "Send message" }).click();
    await expect(messages(author).filter({ hasText: text })).toHaveCount(1);
    await expect(messages(viewer).filter({ hasText: text })).toHaveCount(0);

    // First "ready": the case version differs from the rendered one, so the client resyncs.
    release();
    await waitForRealtime(viewer);
    await expect(messages(viewer).filter({ hasText: text })).toHaveCount(1);
  } finally {
    release();
  }
});

test("an established live connection that drops, even with an HTTP error, reconnects and resyncs changes that do not alter the case version", async ({
  signIn,
  baseURL,
}) => {
  const carter = await caseIdOf("Carter");
  const proxy = await startStreamProxy(baseURL!);
  try {
    // A message to react to, posted before the viewer opens the page.
    const author = await signIn("nguyen@riverside.demo");
    await author.goto(`/cases/${carter}/discussion`);
    const text = `Reaction target (e2e ${Date.now()})`;
    await author.getByPlaceholder(/Message the care team/).fill(text);
    await author.getByRole("button", { name: "Send message" }).click();
    const target = messages(author).filter({ hasText: text });
    await expect(target).toHaveCount(1);

    // The viewer browses through the proxy and is live.
    const viewer = await signIn("smith@riverside.demo");
    await viewer.goto(`${proxy.origin}/cases/${carter}/discussion`);
    await waitForRealtime(viewer);
    await expect.poll(() => proxy.openStreams()).toBe(1);
    const viewerTarget = messages(viewer).filter({ hasText: text });
    await expect(viewerTarget).toHaveCount(1);

    // The established stream breaks. The next attempt gets HTTP 502 (the browser stops retrying
    // on its own after that), and later attempts are held: the viewer is offline for a while.
    proxy.failNextStreams(1);
    proxy.hold();
    const requestsBefore = proxy.eventRequests();
    proxy.dropStreams();
    await expect(viewer.getByTitle("Reconnecting…")).toBeVisible();
    await expect.poll(() => proxy.heldRequests(), { timeout: 15_000 }).toBeGreaterThan(0); // the app retried after the 502
    expect(proxy.eventRequests()).toBeGreaterThanOrEqual(requestsBefore + 2);

    // Meanwhile the author reacts. Reactions do not change the case version, so only the
    // "reconnected" branch of the client can bring this change back.
    await target.hover();
    await target.getByRole("button", { name: "Add reaction" }).click();
    await author.getByRole("button", { name: "👀" }).click();
    await expect(target.getByRole("button", { name: /👀\s*1/ })).toBeVisible();
    await expect(viewerTarget.getByRole("button", { name: /👀/ })).toHaveCount(0);

    // The connection comes back: a second "ready", so the client resyncs.
    proxy.release();
    await waitForRealtime(viewer);
    await expect(viewerTarget.getByRole("button", { name: /👀\s*1/ })).toBeVisible();
  } finally {
    await proxy.close();
  }
});
