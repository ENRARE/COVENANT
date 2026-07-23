export type IdentifierKind = "decision" | "authorization";

export type IdentifierGenerator = {
  createId(kind: IdentifierKind, stableContext: string): Promise<unknown>;
};
