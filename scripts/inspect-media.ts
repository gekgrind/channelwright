import path from "node:path";
import { inspectMedia } from "../src/server/rendering/media-inspection";

const input = process.argv[2];
if (!input) throw new Error("Usage: npm.cmd run video:inspect -- <path-to-media>");
const resolved = path.resolve(process.cwd(), input);
console.log(JSON.stringify(await inspectMedia(resolved), null, 2));
