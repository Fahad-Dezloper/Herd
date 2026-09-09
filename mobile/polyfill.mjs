// Bun 1.2.x does not ship DecompressionStream / CompressionStream, which Expo's
// prebuild needs to extract template tarballs. Bridge node:zlib into the Web
// Streams shape so the CLI works without node.
import zlib from "node:zlib";
import { Duplex } from "node:stream";

function bridge(transform) {
  const web = Duplex.toWeb(transform);
  return { readable: web.readable, writable: web.writable };
}

if (typeof globalThis.DecompressionStream === "undefined") {
  globalThis.DecompressionStream = class DecompressionStream {
    readable; writable;
    constructor(format) {
      const t =
        format === "gzip" ? zlib.createGunzip()
        : format === "deflate" ? zlib.createInflate()
        : zlib.createInflateRaw();
      Object.assign(this, bridge(t));
    }
  };
}

if (typeof globalThis.CompressionStream === "undefined") {
  globalThis.CompressionStream = class CompressionStream {
    readable; writable;
    constructor(format) {
      const t =
        format === "gzip" ? zlib.createGzip()
        : format === "deflate" ? zlib.createDeflate()
        : zlib.createDeflateRaw();
      Object.assign(this, bridge(t));
    }
  };
}
