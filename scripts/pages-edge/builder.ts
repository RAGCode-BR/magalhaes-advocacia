// Executado apenas dentro da Edge Function. O contexto foi autenticado antes do dispatch.
export function createServerFn() {
  let validate = (value: any) => value;
  const builder = {
    middleware() {
      return builder;
    },
    inputValidator(fn: typeof validate) {
      validate = fn;
      return builder;
    },
    handler(fn: any) {
      return ({ data, context }: any) => fn({ data: validate(data), context });
    },
  };
  return builder;
}
export const requireSupabaseAuth = {};
