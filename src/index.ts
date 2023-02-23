/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  // MY_KV_NAMESPACE: KVNamespace;
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  // MY_BUCKET: R2Bucket;

  r2Bucket: R2Bucket;
  eriasr2KV: KVNamespace;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    try {
      if (request.method != "GET") {
        return new Response("Method is not allowed", {
          status: 405,
        });
      }

      const url = new URL(request.url);
      const objectKey = url.pathname.slice(1);

      // Construct the cache key from the cache URL
      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;
      console.log("1: " + cacheKey.url);

      // Check whether the value is already available in the cache
      // if not, you will need to fetch it from R2, and store it in the cache
      // for future access
      let objectCache = await cache.match(cacheKey.url);

      if (objectCache) {
        return respondWithObject(objectCache, ctx, cacheKey, "CF-HIT");
      }

      // If not in cf cache, get it from KV cache
      let objectKV = await env.eriasr2KV.get("objectKey", { type: "stream" });

      if (objectKV === null) {
        console.log("no kv store");
      }

      if (objectKV) {
        return respondWithObject(objectKV, ctx, cacheKey, "KV-HIT");
      }

      // If not in cache, get it from R2
      const objectR2 = await env.r2Bucket.get(objectKey);

      if (objectR2) {
        return respondWithObject(objectR2, ctx, cacheKey, "MISS");
      }

      return new Response("Object not Found", {
        status: 404,
      });
    } catch (e: any) {
      console.log(e);
      return new Response("Error thrown: " + e.message);
    }
  },
};

const respondWithObject = (
  object: any,
  ctx: ExecutionContext,
  cacheKey: Request,
  cacheState: string
): Response => {
  try {
    const cache = caches.default;

    // Set the appropriate object headers
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);

    // Cache API respects Cache-Control headers. Setting s-max-age to 10
    // will limit the response to be in cache for 10 seconds max
    // Any changes made to the response here will be reflected in the cached value
    //headers.append('Cache-Control', 's-maxage=10');
    headers.append("Cache-Control", "public, max-age=31536000, immutable");
    headers.append("Access-Control-Allow-Origin", "*");
    headers.append("eriascdn-cache", `${cacheState}`);

    const response = new Response(object.body, {
      headers,
    });

    // Store the fetched response as cacheKey
    // Use waitUntil so you can return the response without blocking on
    // writing to cache
    // Write only to cache if it is not in cache already

    cacheState !== "CF-HIT" && console.log("2: " + cacheKey.url);
    cacheState !== "CF-HIT" &&
      ctx.waitUntil(cache.put(cacheKey.url, response.clone()));

    return response;
  } catch (e: any) {
    return new Response("Error thrown: " + e.message);
  }
};
