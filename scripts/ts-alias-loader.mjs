export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const file = new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url);
    return nextResolve(file.href, context);
  }
  return nextResolve(specifier, context);
}
