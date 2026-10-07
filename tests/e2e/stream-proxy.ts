import http from "node:http";
import type { AddressInfo } from "node:net";

const EVENTS_PATH = /^\/api\/cases\/[^/]+\/events$/;

/**
 * A pass-through HTTP proxy in front of the app, so a test can break an
 * *established* realtime stream (which the browser cannot be told to do),
 * answer reconnection attempts with an HTTP error, or hold them back.
 * Cookies are scoped by host, not port, so a signed-in context stays signed in
 * when it browses through the proxy's origin.
 */
export async function startStreamProxy(target: string) {
  const upstream = new URL(target);
  const streams = new Set<http.ServerResponse>();
  let held: Array<() => void> = [];
  let holding = false;
  let failNext = 0;
  let eventRequests = 0;

  const server = http.createServer((request, response) => {
    const isEvents = EVENTS_PATH.test((request.url ?? "").split("?")[0]!);
    if (isEvents) eventRequests += 1;
    if (isEvents && failNext > 0) {
      failNext -= 1;
      response.writeHead(502, { "content-type": "text/plain" }).end("Bad gateway (test proxy)");
      return;
    }
    const forward = () => {
      const proxied = http.request(
        { host: upstream.hostname, port: upstream.port, method: request.method, path: request.url, headers: request.headers },
        (reply) => {
          response.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(response);
          if (isEvents) {
            streams.add(response);
            response.on("close", () => streams.delete(response));
          }
        },
      );
      proxied.on("error", () => response.destroy());
      response.on("close", () => proxied.destroy());
      request.pipe(proxied);
    };
    if (isEvents && holding) held.push(forward);
    else forward();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const release = () => {
    holding = false;
    const pending = held;
    held = [];
    for (const forward of pending) forward();
  };

  return {
    origin: `http://127.0.0.1:${port}`,
    /** Realtime streams currently open through the proxy. */
    openStreams: () => streams.size,
    /** Realtime requests seen so far (connections and reconnection attempts). */
    eventRequests: () => eventRequests,
    /** Requests waiting in hold(). */
    heldRequests: () => held.length,
    /** Cut every open realtime stream, as a network failure would. */
    dropStreams: () => {
      for (const stream of streams) stream.destroy();
    },
    /** Answer the next `count` realtime requests with HTTP 502. */
    failNextStreams: (count: number) => {
      failNext = count;
    },
    /** Keep new realtime requests waiting until release(). */
    hold: () => {
      holding = true;
    },
    release,
    close: async () => {
      release();
      for (const stream of streams) stream.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
