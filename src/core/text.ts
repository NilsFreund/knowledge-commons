/** Marks are dropped rather than replaced, so `prüfen` folds to `prufen` instead of splitting in two. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ß', 'ss')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Normalized like the text they are checked against, or `für` would never match the `fur` it becomes. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  `a an as at be by do if in is it me my no of on or so to up us we
   the and but for with from this that these those are was were been being has have had does did doing
   not never only also very can could should would will shall may might must there here when while what
   which who whom whose how why you your yours our its into out over about after before because both
   they them their his her him she mine one two all any each every some such own same too just more
   most other others always than then
   am da du er es im ja ob um zu
   der die das den dem des ein eine einen einem eines und oder aber wenn dann als wie was wer wo wann
   nicht nie immer noch schon nur auch sehr kann könnte soll sollte muss müssen wird werden wurde worden
   sind ist war waren sein seine ihre ihren für mit von bei aus nach über unter vor durch gegen ohne
   man sich selbst dass weil damit sodass bitte wir ich mir mich dir dich uns ihr ihm ihn sie auf zum
   zur beim vom ins alle alles diese dieser dieses kein keine keinen haben hat habe hier dort jetzt mal`
    .split(/\s+/)
    .filter(Boolean)
    .map(normalize),
)
