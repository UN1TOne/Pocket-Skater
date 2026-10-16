// Type shims for packages that ship incomplete / legacy typings.

declare module "recast-detour" {
  // The ESM build exports an Emscripten factory that resolves to the Recast module.
  const Recast: (moduleArg?: Record<string, unknown>) => Promise<unknown>;
  export default Recast;
}
