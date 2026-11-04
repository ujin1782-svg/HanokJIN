// 목조 건축문화유산 손상 표준 분류 체계와 보고서 용어 교정 규칙.
// 분류 체계: 손상(총칭) → 열화·풍화·훼손(중위) → 14개 시각 판별 클래스(하위).
// 출처: 최현서·김소현·김윤상(2025), 건축역사연구 34(3) pp.19-30. 클래스 번호(id)는 YOLO 학습 클래스 번호와 같다.

import type { DamageSeverity } from '../core/types';
import { TERM_ROWS } from './terms';

export type ClassId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export type Feasibility = 'high' | 'mid' | 'low';

export interface DamageClass {
  id: ClassId;
  key: string;          // 영문 키(데이터셋 클래스명)
  ko: string;           // 표준 용어
  en: string;
  group: string;        // 현상 속성군
  mid: '열화' | '풍화' | '훼손';
  path: string[];       // 손상(총칭)부터의 계층
  definition: string;
  tip: string;          // 판별 요령
  feasibility: Feasibility;
  measure?: string;     // 사진만으로 부족할 때 병행할 계측
  phrase: string;       // 조사내용 문구의 현상 서술(목적격 앞까지)
}

const ROOT = '손상';

export const CLASSES: readonly DamageClass[] = [
  { id: 0, key: 'Check', ko: '할렬', en: 'Check', group: '갈라짐', mid: '열화', path: [ROOT, '열화', '갈라짐', '갈램', '할렬'],
    definition: '목부재가 건조수축 등 자체 특성으로 섬유 방향과 평행하게 갈라지는 현상. 횡단면에서는 중심에서 바깥쪽 방사 방향으로 나타난다.',
    tip: '기둥·보 표면에 세로(섬유 방향)로 길게 갈라진 건조 갈램', feasibility: 'high', measure: '깊이는 탐침으로 확인',
    phrase: '목재 건조수축에 의해 섬유 방향과 평행하게 발달한 할렬(Check)' },
  { id: 1, key: 'Shake', ko: '윤할', en: 'Shake', group: '갈라짐', mid: '열화', path: [ROOT, '열화', '갈라짐', '갈램', '윤할'],
    definition: '목부재 단면의 연륜(나이테)을 따라 둥글게 층이 분리되듯 생기는 갈라짐(테 갈램).',
    tip: '마구리(횡단면)에서 나이테를 따라 호 모양으로 갈라짐', feasibility: 'high',
    phrase: '연륜(나이테)을 따라 둥글게 분리된 윤할(Shake)' },
  { id: 2, key: 'Split', ko: '분할', en: 'Split', group: '갈라짐', mid: '열화', path: [ROOT, '열화', '갈라짐', '갈램', '분할'],
    definition: '부재 끝부분에서 섬유 방향과 평행하게 갈라져 단면을 관통하며 쪼개지듯 벌어지는 현상.',
    tip: '창방·보·기둥 끝단에서 시작해 단면을 관통하며 벌어짐', feasibility: 'high',
    phrase: '부재 끝단에서 단면을 관통하여 벌어진 분할(Split)' },
  { id: 3, key: 'Gallem', ko: '갈램', en: 'Gallem', group: '갈라짐', mid: '열화', path: [ROOT, '열화', '갈라짐', '갈램'],
    definition: '목부재 자체 특성(건조수축)으로 겉면이나 내부가 갈라지는 현상. 방향을 알 수 있으면 할렬·윤할·분할로 세분한다.',
    tip: '목재 자체의 갈라짐이지만 방향을 특정하기 어려울 때', feasibility: 'high',
    phrase: '목재 자체 특성에 의한 갈램' },
  { id: 4, key: 'Crack', ko: '균열', en: 'Crack', group: '갈라짐', mid: '열화', path: [ROOT, '열화', '갈라짐', '균열'],
    definition: '벽체·치받이·당골막이 등 미장부의 갈라짐이나 구조적 외력에 의한 갈라짐. 목재 자체의 건조 갈라짐은 제외한다(→ 갈램).',
    tip: '회벽·흙벽·모르타르 표면 균열이나 구조적 파단일 때만', feasibility: 'high',
    phrase: '미장면 균열(Crack)' },
  { id: 5, key: 'Burst', ko: '터짐', en: 'Burst', group: '갈라짐', mid: '열화', path: [ROOT, '열화', '갈라짐', '터짐'],
    definition: '열적·기계적 응력에 의한 국부 파단으로 섬유 직각 방향(가로)으로 터지듯 갈라지는 현상.',
    tip: '나뭇결을 가로질러 국부적으로 끊어지듯 터짐', feasibility: 'high',
    phrase: '섬유 직각 방향으로 국부 파단된 터짐(Burst)' },
  { id: 6, key: 'Apgoe', ko: '압괴', en: 'Crushing', group: '갈라짐', mid: '열화', path: [ROOT, '열화', '갈라짐', '압괴'],
    definition: '부재가 맞닿는 부위(기둥 상하부, 주두 등)에서 집중 하중·압축력으로 목재가 짓눌려 퍼지듯 갈라진 현상(압괘·압궤 → 압괴).',
    tip: '기둥-초석, 기둥-주두 접합부가 눌려 버섯처럼 퍼짐', feasibility: 'high',
    phrase: '접합부 압축력에 의한 압괴' },
  { id: 7, key: 'Tilt', ko: '기욺', en: 'Tilt', group: '변형·변위', mid: '열화', path: [ROOT, '열화', '변형·변위', '기욺'],
    definition: '기둥 등 수직 부재가 수직 기준축에서 한쪽으로 기울어진 상태(‘기울다’의 명사형 ‘기욺’).',
    tip: '문얼굴·인방 대비 기울기가 보임. 귀솟음·안쏠림 같은 의도된 기법과 구분', feasibility: 'mid', measure: '렌즈 왜곡이 있으므로 레이저 레벨·3D 스캔 수직도 계측 병기',
    phrase: '수직축 대비 기욺' },
  { id: 8, key: 'Sagging', ko: '처짐', en: 'Sagging', group: '변형·변위', mid: '열화', path: [ROOT, '열화', '변형·변위', '처짐'],
    definition: '보·도리·서까래 등 수평 부재가 하중으로 아래로 휜 상태.',
    tip: '수평 기준선 대비 중앙부가 내려앉음', feasibility: 'mid', measure: '수평 기준선·처짐량 계측 병기',
    phrase: '수평 부재의 처짐' },
  { id: 9, key: 'Separation', ko: '이격', en: 'Separation', group: '분리·탈락', mid: '열화', path: [ROOT, '열화', '분리·탈락', '이격'],
    definition: '결구부 맞춤이 벌어져 부재 사이에 틈이 생긴 상태(이완·빠짐·분리를 사진상 틈으로 확인한 경우 포함).',
    tip: '맞춤·이음부에 틈이 벌어져 보임', feasibility: 'high',
    phrase: '결구부 맞춤의 이격' },
  { id: 10, key: 'Spalling', ko: '박락·탈락', en: 'Spalling', group: '분리·탈락', mid: '풍화', path: [ROOT, '풍화', '분리·탈락', '박락·탈락'],
    definition: '단청·미장·마감층이나 부재 일부가 얇게 벗겨지거나 떨어져 나간 현상(박리·들뜸·결실 포함).',
    tip: '표면층이 떨어져 바탕이 드러남', feasibility: 'high',
    phrase: '마감층 박락 및 탈락' },
  { id: 11, key: 'Decay', ko: '부후', en: 'Decay', group: '생물·수분 열화', mid: '열화', path: [ROOT, '열화', '생물·수분 열화', '부후'],
    definition: '수분과 목재부후균의 작용으로 세포벽이 분해되어 재질이 무르고 썩는 현상. 금속 용어인 ‘부식’을 목재에 쓰지 않는다.',
    tip: '흑갈색 변색, 섬유 조직 붕괴, 푸석한 표면', feasibility: 'high', measure: '내부 부후·공동은 사진으로 알 수 없으므로 천공저항·초음파 측정 병행',
    phrase: '수분 및 생물 요인에 의한 목재 부후(Decay)' },
  { id: 12, key: 'Insect_Damage', ko: '충해', en: 'Insect damage', group: '생물·수분 열화', mid: '열화', path: [ROOT, '열화', '생물·수분 열화', '충해'],
    definition: '천공충·흰개미 등 곤충에 의한 피해. 표면 천공 구멍과 식해 흔적으로 확인한다.',
    tip: '작은 원형 천공, 목분(벌레똥) 배출', feasibility: 'high', measure: '내부 흰개미 피해는 비파괴 탐지 병행',
    phrase: '천공 및 식해 흔적을 동반한 충해' },
  { id: 13, key: 'Discoloration', ko: '변색·오염', en: 'Discoloration', group: '표면 오염·변색', mid: '풍화', path: [ROOT, '풍화', '표면 오염·변색', '변색·오염'],
    definition: '누수흔·습해흔·백화·퇴색·표면 오염균 등으로 표면 색이 변하거나 더러워진 현상.',
    tip: '얼룩, 하얀 염류(백화), 색 바램', feasibility: 'high', measure: '습윤 범위는 함수율계·열화상 병행',
    phrase: '누수·습해 등에 의한 표면 변색 및 오염' },
];

export const classById = (id: ClassId) => CLASSES[id];

export const FEASIBILITY_LABEL: Record<Feasibility, string> = {
  high: '사진으로 판별 가능', mid: '계측 병행 권장', low: '사진 판별 불가',
};

/* ───── 보고서 용어 교정 ───── */

export type IssueKind = 'ok' | 'notation' | 'grammar' | 'synonym' | 'meaning' | 'generic';

export const ISSUE_LABEL: Record<IssueKind, string> = {
  ok: '표준 용어', notation: '표기 혼용', grammar: '어문 규정 미준수', synonym: '동의어·일상어', meaning: '분야별 의미 충돌', generic: '포괄어(세분화 필요)',
};

interface Rule { cls?: ClassId; issue: IssueKind; reason?: string }

// 용어별 교정 규칙. 사전에 없는 표기나 여기 없는 용어는 14개 클래스로 바로 옮기지 않고 지침만 보여 준다.
const RULES: Record<string, Rule> = {
  할렬: { cls: 0, issue: 'ok' },
  할열: { cls: 0, issue: 'notation', reason: '목재건조학·보존학 용어가 섞여 ‘할열’로 적힌 경우입니다. 표준시방서 기준 ‘할렬(割裂)’로 통일합니다.' },
  갈램: { cls: 3, issue: 'ok', reason: '갈라진 방향을 알 수 있으면 할렬·윤할·분할로 세분하세요.' },
  '갈라-': { cls: 3, issue: 'grammar', reason: '‘갈라짐·갈라져’ 같은 용언형은 명사형 표준 용어로 바꿉니다.' },
  갈라짐: { cls: 3, issue: 'generic', reason: '갈라짐은 8개 용어의 상위 속성입니다. 재료·방향에 따라 균열·할렬·윤할·분할·터짐·압괴 중에서 고르세요.' },
  쪼개짐: { cls: 2, issue: 'synonym', reason: '일상어 ‘쪼개짐’은 부재 끝단 관통 갈라짐인 ‘분할(Split)’로 정제합니다.' },
  터짐: { cls: 5, issue: 'ok' },
  끊어짐: { cls: 5, issue: 'synonym', reason: '섬유가 직각 방향으로 끊어진 경우 ‘터짐’, 부재가 절단되면 ‘부러짐’으로 기록합니다.' },
  압괴: { cls: 6, issue: 'ok' },
  우그러짐: { cls: 6, issue: 'synonym', reason: '접합부 압축으로 눌린 경우 ‘압괴’로 기록합니다.' },
  기욺: { cls: 7, issue: 'ok' },
  기울음: { cls: 7, issue: 'grammar', reason: '‘기울음’은 비표준어입니다(‘기울-’+‘-ㅁ’ → ‘기욺’).' },
  기울어짐: { cls: 7, issue: 'grammar', reason: '‘기울어짐’은 기울어지는 행위를 뜻합니다. 기울어진 상태는 ‘기욺’으로 통일합니다.' },
  안쏠림: { cls: 7, issue: 'generic', reason: '안쏠림은 의도된 전통 기법일 수 있습니다. 구조적 변위일 때만 ‘기욺’으로 기록하세요.' },
  처짐: { cls: 8, issue: 'ok' },
  휨: { cls: 8, issue: 'synonym', reason: '수평 부재가 아래로 휜 경우 ‘처짐’으로 기록합니다.' },
  이격: { cls: 9, issue: 'ok' },
  분리: { cls: 9, issue: 'synonym', reason: '접합된 부재가 떨어진 경우 ‘이격’으로 기록합니다.' },
  빠짐: { cls: 9, issue: 'synonym', reason: '촉·장부·산지가 빠져 틈이 보이면 ‘이격’으로 기록합니다.' },
  이탈: { cls: 9, issue: 'synonym', reason: '제자리를 벗어나 틈이 생기면 ‘이격’, 떨어져 나갔으면 ‘탈락’입니다.' },
  이완: { cls: 9, issue: 'generic', reason: '결구가 느슨해진 상태는 구조 계측이 필요합니다. 사진상 틈이 보이면 ‘이격’으로 기록하세요.' },
  탈락: { cls: 10, issue: 'ok' },
  박락: { cls: 10, issue: 'ok' },
  박리: { cls: 10, issue: 'ok' },
  들뜸: { cls: 10, issue: 'ok', reason: '들뜸은 박락의 전조입니다. 떨어져 나가기 전이면 위치를 함께 적어 두세요.' },
  결실: { cls: 10, issue: 'ok' },
  유실: { cls: 10, issue: 'ok' },
  멸실: { cls: 10, issue: 'ok' },
  노출: { cls: 10, issue: 'ok', reason: '마감 탈락 후 바탕재가 드러난 경우입니다.' },
  철물결실: { cls: 10, issue: 'ok' },
  벗겨짐: { cls: 10, issue: 'synonym', reason: '일상어 ‘벗겨짐’은 ‘박리·박락’으로 정제합니다.' },
  부후: { cls: 11, issue: 'ok' },
  부식: { cls: 11, issue: 'meaning', reason: '‘부식(Corrosion)’은 금속이 산화되는 현상입니다. 목재가 썩는 현상은 ‘부후(Decay)’로 기록하고, 철물에만 ‘부식’을 씁니다.' },
  썩음: { cls: 11, issue: 'synonym', reason: '일상어 ‘썩음’은 전문용어 ‘부후(Decay)’로 정제합니다.' },
  충해: { cls: 12, issue: 'ok' },
  '충해흔(적)': { cls: 12, issue: 'ok' },
  천공: { cls: 12, issue: 'ok', reason: '곤충에 의한 천공이면 ‘충해’, 인위적 구멍이면 따로 기록합니다.' },
  변색: { cls: 13, issue: 'ok' },
  오염: { cls: 13, issue: 'ok' },
  퇴색: { cls: 13, issue: 'ok' },
  백화: { cls: 13, issue: 'ok' },
  누수: { cls: 13, issue: 'generic', reason: '누수는 원인입니다. 사진에 보이는 얼룩은 ‘변색·오염(누수흔)’으로 기록하고, 습윤 범위는 열화상으로 확인하세요.' },
  '누수흔(적)': { cls: 13, issue: 'ok' },
  습해: { cls: 13, issue: 'generic', reason: '습기로 인한 얼룩은 ‘변색·오염’, 썩음이 진행됐으면 ‘부후’로 기록합니다.' },
  습해흔: { cls: 13, issue: 'ok' },
  흘러내림: { cls: 13, issue: 'ok' },
  표면오염균: { cls: 13, issue: 'ok' },
  균열: { cls: 4, issue: 'synonym', reason: '‘균열’은 미장부·구조적 갈라짐에만 씁니다. 목부재 자체의 건조 갈라짐이면 ‘갈램’(방향을 알면 할렬·윤할·분할)으로 바꾸세요.' },
  손상: { issue: 'generic', reason: '‘손상’은 최상위 총칭입니다. 구체적인 현상 용어로 다시 분류하세요.' },
  훼손: { issue: 'generic', reason: '‘훼손’은 고의적 파손·도난 등 인위적 원인을 뜻하는 중위 개념입니다. 낙서·파손 등 실제 현상을 기록하세요.' },
  열화: { issue: 'generic', reason: '‘열화’는 중위 개념입니다. 구체적인 현상 용어로 다시 분류하세요.' },
  풍화: { issue: 'generic', reason: '‘풍화’는 중위 개념입니다. 마모·퇴색 등 하위 현상으로 기록하세요.' },
  노후: { issue: 'generic', reason: '포괄 상태어입니다. 구체적인 손상 용어로 다시 분류하세요.' },
  노후화: { issue: 'generic', reason: '포괄 상태어입니다. ‘열화’ 아래 구체적인 손상 용어로 다시 분류하세요.' },
  퇴락: { issue: 'generic', reason: '포괄 상태어입니다. 구체적인 손상 용어로 분해해 기록하세요.' },
  변형: { issue: 'generic', reason: '포괄 용어입니다. 기욺·처짐·뒤틀림·배부름 등 구체 현상으로 정제하세요.' },
  변위: { issue: 'generic', reason: '위치 이동 포괄 용어입니다. 기욺·이격·침하 등으로 정제하세요.' },
  파손: { issue: 'generic', reason: '깨짐·부러짐·결실 등 구체적인 파괴 양상으로 기록하세요.' },
  서식: { issue: 'generic', reason: '식물 생장 또는 충해로 구체화하세요.' },
  비틀림: { issue: 'synonym', reason: '‘뒤틀림’과 같은 뜻입니다. ‘뒤틀림’으로 통일합니다(14개 시각 클래스 밖의 현상).' },
  내려앉음: { issue: 'synonym', reason: '기단·초석이면 ‘침하’, 수평 부재면 ‘처짐’으로 표준화합니다.' },
  공동화: { issue: 'generic', reason: '부재 내부가 빈 현상은 사진으로 판별할 수 없습니다. 초음파·천공저항 측정이 필요합니다.' },
};

export interface TermEntry {
  term: string; count: number; category: string; feasibility: string; standard: string; guide: string;
  cls?: ClassId; issue: IssueKind; reason?: string;
}

export const TERMS: readonly TermEntry[] = TERM_ROWS.map(([term, count, category, feasibility, standard, guide]) => {
  const r = RULES[term] ?? { issue: 'ok' as const };
  return { term, count, category, feasibility, standard, guide, ...r };
});

export const TOTAL_MENTIONS = TERMS.reduce((s, t) => s + t.count, 0);

export interface Correction {
  input: string;
  entry?: TermEntry;     // 일치한 사전 용어
  cls?: ClassId;         // 제안 클래스
  issue: IssueKind;
  reason: string;
}

const isPlasterPart = (part: string) => /벽|미장|치받이|당골|화방|회벽|흙/.test(part);

/** 보고서 원문 표기(예: "기둥 할열", "판벽 부식")에서 손상 용어를 찾아 표준 클래스를 제안한다. */
export function correctTerm(raw: string, part = ''): Correction {
  const input = raw.trim();
  if (!input) return { input, issue: 'ok', reason: '' };
  const text = input.replace(/\s+/g, '');
  // 가장 긴 표기를 먼저 찾는다(‘누수흔’이 ‘누수’보다 우선).
  const keyOf = (t: string) => t.replace(/\(.*?\)|-/g, '');
  const entry = [...TERMS].sort((a, b) => keyOf(b.term).length - keyOf(a.term).length)
    .find((t) => keyOf(t.term) && text.includes(keyOf(t.term)));
  if (!entry) return { input, issue: 'ok', reason: '사전에 없는 표기입니다. 아래 14개 표준 분류에서 직접 고르세요.' };
  let cls = entry.cls, issue = entry.issue, reason = entry.reason ?? '';
  if (entry.term === '균열') {
    if (isPlasterPart(part) || isPlasterPart(input)) { cls = 4; issue = 'ok'; reason = '미장부 갈라짐이므로 ‘균열(Crack)’이 맞습니다.'; }
    else { cls = 3; }
  }
  if (entry.term === '부식' && /철물|못|정|감잡이|광두정|띠쇠/.test(input + part)) { cls = undefined; issue = 'ok'; reason = '철물의 산화는 ‘부식’이 맞습니다(14개 목재 시각 클래스 밖의 현상).'; }
  return { input, entry, cls, issue, reason };
}

/* ───── 조사내용 문구 ───── */

/** 받침 유무에 따라 조사를 고른다. 괄호 속 영문은 건너뛰고 마지막 한글 글자로 판단한다. */
export function josa(word: string, withBatchim: string, without: string): string {
  const hangul = word.replace(/\([^)]*\)/g, '').match(/[가-힣](?=[^가-힣]*$)/);
  if (!hangul) return without;
  return (hangul[0].charCodeAt(0) - 0xac00) % 28 ? withBatchim : without;
}

export const SEVERITY_LABEL: Record<DamageSeverity, string> = { minor: '경미', moderate: '보통', severe: '심각' };

const ACTION: Record<DamageSeverity, string> = {
  minor: '차기 정기조사 시 진행 여부를 관찰함',
  moderate: '진행 여부에 대한 정기적인 모니터링이 필요함',
  severe: '정밀 진단 및 보수 방안 검토가 필요함',
};

/** 정기조사 보존사항 ‘조사내용’ 문구 초안. */
export function draftStatement(cls: ClassId, member: string, location: string, severity: DamageSeverity): string {
  const c = classById(cls);
  const where = [member, location].filter(Boolean).join(' ') || '해당 부재';
  const m = c.feasibility !== 'high' && c.measure ? c.measure.replace(/\.$/, '') : '';
  const measure = m ? ` ${m}${josa(m, '을', '를')} 권장함.` : '';
  return `${where}에서 ${c.phrase}${josa(c.phrase, '이', '가')} 확인되므로 ${ACTION[severity]}.${measure}`;
}
