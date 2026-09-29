import { register } from "node:module";

register(new URL("./ts-alias-loader.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});
