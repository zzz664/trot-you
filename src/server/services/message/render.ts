import 'server-only';
import { MESSAGE_NAME_TOKEN } from '@/config/artists';

// Input calling name is validated by the database's current approved policy.
// This is plain text, NOT HTML: render via React text nodes (never innerHTML).
// Split/join preserves literal `$&`, markup, and name tokens inside the name.
export function renderMessage(
  template: string | null,
  validatedCallName: string,
) {
  return template === null
    ? null
    : template.split(MESSAGE_NAME_TOKEN).join(validatedCallName);
}
