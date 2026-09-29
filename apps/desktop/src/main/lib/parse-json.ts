import type { ZodType } from "zod";

/** JSON from outside this process (a child's frames, renderer input): null when
 *  it is malformed or not the expected shape, never a throw or a half-read object. */
export function parseJson<T>(text: string, schema: ZodType<T>): T | null {
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
