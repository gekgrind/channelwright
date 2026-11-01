import { NextResponse } from "next/server";

/**
 * A 303 whose relative Location the browser resolves against its own public origin.
 *
 * Behind TLS termination, request.url can carry Next's internal host and port (https://localhost:3005), so an
 * absolute redirect built from it leaves the public site. No Host, Origin, forwarded header or user input is read.
 */
export function sameOriginRedirect(path: `/${string}`) {
  // URL parsing strips TAB/LF/CR, so `/<TAB>/host` would become `//host`; reject every control character first.
  if (/[\u0000-\u001f\u007f]/.test(path) || !/^\/(?![/\\])/.test(path)) throw new Error("Redirect path must be a same-origin absolute path");
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
