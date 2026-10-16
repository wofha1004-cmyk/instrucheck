/* 장비 목록 (알림 스크립트 공용). public/index.html 의 EQUIPMENT 와 순서·이름을 똑같이 유지하세요. */
export const EQUIPMENT = [
  'HPLC 1200 (창문쪽)', 'HPLC 1200', 'HPLC 1260 II (창문쪽)', 'HPLC 1260 II FLD', 'HPLC 1260 II ELSD', 'HPLC 1260 III',
  'Prep HPLC', 'LC-MS',
  'GC 7890A', 'GC 7890B', 'GC-MS',
  'Moisture meter (HX204)', 'Oven Karl Fischer', 'Karl Fischer (Volumetric)',
  'Balance (Oven KF, XPR204V)', 'Analytical balance (XPE205)', '초순수제조기',
].map((name, i) => ({ id: 'eq' + String(i + 1).padStart(2, '0'), name }));
