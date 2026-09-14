/* Radio groups — one field per radio button.
 *
 * A radio group used to be a *single* field whose `options` held every choice,
 * drawn as a list inside one box. That made the group a block: the sender could
 * move the block, but not the buttons. Real forms almost never lay their radio
 * buttons out that way — they sit beside the paragraphs they answer, scattered
 * across the page — so the only way to place them was to author one radio
 * "group" per button, which the API then treats as separate questions and lets
 * the signer answer all of them at once.
 *
 * So a group is now a *set* of `radio` fields, one per button, each freely
 * positioned. What ties them together lives in every member's `options`:
 *
 *     { kind: 'radio', group, choice, choices, groupLabel }
 *
 * `choice` is that button's own label; `choices` is the whole group's list, in
 * the order the inspector shows it, and is duplicated onto every member on
 * purpose — it is what `field_service.allowed_options` reads, so the closed set
 * the API enforces is the group's set rather than one button's label. The
 * group's answer is therefore a single value every member carries: picking one
 * button writes the same value to all of them, which is what makes the choice
 * exclusive, keeps `required` satisfiable per row, and lets the flattened PDF
 * decide each button's ink by comparing the value with its own `choice`.
 *
 * A radio field with no `group` is one authored before this — or through the
 * API — and stays what it was: one box listing its choices.
 */
import type { SFField } from './state';

/** The group membership carried by one radio button's `options`. */
export type RadioOptions = {
  /** Shared by every button of the group. */
  group: string;
  /** This button's own label — the value the group takes when it is picked. */
  choice: string;
  /** Every choice in the group, in the inspector's order. */
  choices: string[];
  /** The group's name, shown in the inspector and in a signer's accessible name. */
  groupLabel: string;
};

/** Default size of one radio button, in PDF points. */
export const RADIO_SIZE = 20;
/** Vertical pitch between the buttons of a freshly placed group. */
export const RADIO_PITCH = 26;
/** How many buttons a newly placed group starts with. */
export const RADIO_INITIAL_OPTIONS = 3;
/** A button can be resized smaller than an ordinary field — it is a dot. */
export const RADIO_MIN_SIZE = 12;

const str = (value: unknown) => (value === null || value === undefined ? '' : String(value));

/**
 * The group membership on a field's `options`, or null when the row is not a
 * member of one (a legacy single-box radio, or any other field type).
 */
export function radioOptions(options: unknown): RadioOptions | null {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
  const raw = options as { group?: unknown; choice?: unknown; choices?: unknown; groupLabel?: unknown };
  const group = str(raw.group);
  const choice = str(raw.choice);
  if (!group || !choice) return null;
  const choices = Array.isArray(raw.choices) ? raw.choices.map(str).filter(text => text.length > 0) : [];
  return {
    group,
    choice,
    // A member always offers at least its own label, so a group whose `choices`
    // was lost still validates server-side rather than locking the signer out.
    choices: choices.length ? choices : [choice],
    groupLabel: str(raw.groupLabel) || 'Radio Group',
  };
}

/** `options` for one member of a group. */
export function radioMemberOptions(member: RadioOptions): Record<string, unknown> {
  return {
    kind: 'radio',
    group: member.group,
    choice: member.choice,
    choices: member.choices.slice(),
    groupLabel: member.groupLabel,
  };
}

export function newRadioGroupId(): string {
  return 'rg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** The label a newly added button gets: "Radio Button N", N unused so far. */
export function nextRadioChoice(choices: string[]): string {
  for (let n = choices.length + 1, guard = 0; guard < 200; n += 1, guard += 1) {
    const candidate = 'Radio Button ' + n;
    if (choices.indexOf(candidate) < 0) return candidate;
  }
  return 'Radio Button ' + Date.now().toString().slice(-4);
}

export type RadioMember<T> = { field: T; options: RadioOptions };

/**
 * One group's buttons, in the group's own order.
 *
 * Ordered by `choices` rather than by position: the inspector's list must not
 * reshuffle itself when the sender drags a button up the page, and a button
 * whose label is no longer in the list (a half-applied rename) still has to be
 * reachable, so it is kept at the end rather than dropped.
 */
export function radioGroupMembers<T extends { id: string }>(
  fields: T[],
  optionsOf: (field: T) => unknown,
  group: string,
): RadioMember<T>[] {
  const members: RadioMember<T>[] = [];
  for (const field of fields) {
    const options = radioOptions(optionsOf(field));
    if (options && options.group === group) members.push({ field, options });
  }
  const order = members.length ? members[0].options.choices : [];
  const rank = (member: RadioMember<T>) => {
    const at = order.indexOf(member.options.choice);
    return at < 0 ? order.length + members.indexOf(member) : at;
  };
  return members.sort((a, b) => rank(a) - rank(b));
}

/**
 * A newly placed group: one field per button, stacked down the page from
 * (`x`, `y`), each of them positionable on its own from then on.
 */
export function newRadioGroupFields(seed: {
  idFor: (index: number) => string;
  page: number;
  x: number;
  y: number;
  to: string;
  label?: string;
  count?: number;
  maxY?: number;
}): { fields: SFField[]; options: Record<string, Record<string, unknown>> } {
  const group = newRadioGroupId();
  const groupLabel = seed.label || 'Radio Group';
  const count = Math.max(1, seed.count ?? RADIO_INITIAL_OPTIONS);
  const choices: string[] = [];
  for (let i = 0; i < count; i += 1) choices.push(nextRadioChoice(choices));
  const fields: SFField[] = [];
  const options: Record<string, Record<string, unknown>> = {};
  choices.forEach((choice, index) => {
    const id = seed.idFor(index);
    const wanted = seed.y + index * RADIO_PITCH;
    const y = seed.maxY === undefined ? wanted : Math.max(0, Math.min(wanted, seed.maxY - RADIO_SIZE));
    fields.push({
      id, page: seed.page, type: 'radio', x: seed.x, y,
      w: RADIO_SIZE, h: RADIO_SIZE, to: seed.to,
      required: false, readOnly: false, label: groupLabel, placeholder: '',
      validation: 'none', cond: null,
    });
    options[id] = radioMemberOptions({ group, choice, choices, groupLabel });
  });
  return { fields, options };
}
