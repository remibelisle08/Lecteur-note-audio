/**
 * Ressource recréée périodiquement. Sert au phonémiseur piper-wasm : son module Emscripten
 * plante après ~64 appels de callMain (« null function or function signature mismatch »),
 * puis reste inutilisable. On le recrée donc toutes les `maxUses` utilisations, et une fois
 * de plus si un appel échoue (nouvel essai avec une ressource neuve).
 */
export function recycling<R>(create: () => Promise<R>, maxUses: number) {
  let current: Promise<R> | null = null;
  let uses = 0;
  const fresh = () => {
    current = create();
    uses = 0;
    current.catch(() => {
      current = null;
    });
    return current;
  };
  return async function use<T>(fn: (r: R) => Promise<T> | T): Promise<T> {
    if (!current || uses >= maxUses) fresh();
    uses++;
    try {
      return await fn(await current!);
    } catch {
      const r = await fresh();
      uses = 1;
      return await fn(r);
    }
  };
}
