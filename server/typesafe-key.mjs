// The human's TypeSafe key stays with the app. It is taken out of the environment the
// first time it is asked for, so nothing the app starts afterwards, no agent, shell or
// Python session, inherits it.
let taken;
export function typesafeKey(env = process.env) {
  if (taken === undefined || env !== process.env) {
    const key = (env.TYPESAFE_API_KEY || "").trim();
    delete env.TYPESAFE_API_KEY;
    if (env !== process.env) return key;
    taken = key;
  }
  return taken;
}
