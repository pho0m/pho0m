import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { CRC32C } from "@google-cloud/storage";

/**
 * Just enough of the GCS JSON API (with generation preconditions) to run the real SDK against,
 * so the gcs driver is exercised end to end without a cloud project.
 */

type Obj = { data: Buffer; generation: string; contentType: string; cacheControl: string; updated: string };

export type FakeGcs = {
  url: string;
  objects: Map<string, Obj>;
  requests: string[];
  close(): Promise<void>;
};

function crc32c(data: Buffer): string {
  const c = new CRC32C();
  c.update(data);
  return c.toString();
}

function resource(bucket: string, name: string, o: Obj) {
  return {
    kind: "storage#object",
    id: `${bucket}/${name}/${o.generation}`,
    name,
    bucket,
    generation: o.generation,
    metageneration: "1",
    contentType: o.contentType,
    cacheControl: o.cacheControl,
    size: String(o.data.byteLength),
    md5Hash: createHash("md5").update(o.data).digest("base64"),
    crc32c: crc32c(o.data),
    updated: o.updated,
    timeCreated: o.updated,
  };
}

function gcsError(res: http.ServerResponse, code: number, message: string) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code, message, errors: [{ message, reason: "fake" }] } }));
}

function parseMultipart(body: Buffer, contentType: string): { meta: Record<string, unknown>; data: Buffer } {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1]?.replace(/"/g, "");
  if (!boundary) throw new Error("no boundary");
  const delim = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = body.indexOf(delim);
  while (start !== -1) {
    const next = body.indexOf(delim, start + delim.length);
    if (next === -1) break;
    parts.push(body.subarray(start + delim.length, next));
    start = next;
  }
  const content = parts.map((p) => {
    const headerEnd = p.indexOf("\r\n\r\n");
    return p.subarray(headerEnd + 4, p.length - 2); // strip trailing CRLF
  });
  return { meta: JSON.parse(content[0]!.toString("utf8")) as Record<string, unknown>, data: content[1]! };
}

export async function startFakeGcs(bucket: string): Promise<FakeGcs> {
  const objects = new Map<string, Obj>();
  const requests: string[] = [];
  let counter = 1_700_000_000_000_000;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", "http://fake");
      // STORAGE_EMULATOR_HOST clients omit the /storage/v1 prefix.
      if (url.pathname.startsWith("/b/")) url.pathname = `/storage/v1${url.pathname}`;
      requests.push(`${req.method} ${url.pathname}${url.search}`);
      const objPrefix = `/storage/v1/b/${bucket}/o`;
      const uploadPath = `/upload/storage/v1/b/${bucket}/o`;
      const match = url.searchParams.get("ifGenerationMatch");

      if (req.method === "POST" && url.pathname === uploadPath) {
        const { meta, data } = parseMultipart(body, req.headers["content-type"] ?? "");
        const name = url.searchParams.get("name") ?? String(meta.name);
        const live = objects.get(name);
        if (match !== null && (live?.generation ?? "0") !== match) return gcsError(res, 412, "Precondition Failed");
        const o: Obj = {
          data,
          generation: String(++counter),
          contentType: String(meta.contentType ?? "application/octet-stream"),
          cacheControl: String(meta.cacheControl ?? ""),
          updated: new Date().toISOString(),
        };
        objects.set(name, o);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(resource(bucket, name, o)));
      }

      if (url.pathname === objPrefix && req.method === "GET") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const items = [...objects.entries()]
          .filter(([n]) => n.startsWith(prefix))
          .map(([n, o]) => resource(bucket, n, o));
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ kind: "storage#objects", items }));
      }

      if (url.pathname.startsWith(`${objPrefix}/`)) {
        const name = decodeURIComponent(url.pathname.slice(objPrefix.length + 1));
        const o = objects.get(name);
        if (req.method === "DELETE") {
          if (!o) return gcsError(res, 404, "No such object");
          objects.delete(name);
          res.writeHead(204);
          return res.end();
        }
        if (req.method === "GET") {
          const gen = url.searchParams.get("generation");
          if (!o || (gen && gen !== o.generation)) return gcsError(res, 404, "No such object");
          if (url.searchParams.get("alt") === "media") {
            const r = resource(bucket, name, o);
            res.writeHead(200, {
              "content-type": o.contentType,
              "x-goog-hash": `crc32c=${r.crc32c},md5=${r.md5Hash}`,
              "x-goog-generation": o.generation,
            });
            return res.end(o.data);
          }
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify(resource(bucket, name, o)));
        }
      }
      gcsError(res, 404, `fake gcs: unhandled ${req.method} ${url.pathname}`);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    objects,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
