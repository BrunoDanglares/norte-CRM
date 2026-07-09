// Override de tipos do Express 5 pra refletir o que o runtime realmente devolve
// neste projeto.
//
// Em @types/express-serve-static-core 5, ParamsDictionary virou
// `{ [key: string]: string | string[] }` por causa do suporte a wildcards
// (`/user/*id`). Este projeto não usa wildcards em rotas — todo path param é
// string simples. Sem este override, ~150 chamadas a `req.params.X` quebram
// o type-check com TS2345 (`string | string[]` not assignable to `string`).
//
// Mesmo problema com `req.query.X`: tipo é `string | string[] | ParsedQs |
// ParsedQs[] | undefined`. Reduzimos pra `string | undefined` (suficiente
// para query params escalares que é o uso real do projeto).
//
// Augmentation via namespace `Express` é o pattern oficial pra customizar
// `Request`/`Response` — sobrescreve os membros equivalentes na assinatura
// genérica do `express-serve-static-core`.

declare global {
  namespace Express {
    interface Request {
      params: { [key: string]: string };
      query: { [key: string]: string | undefined };
    }
  }
}

export {};
