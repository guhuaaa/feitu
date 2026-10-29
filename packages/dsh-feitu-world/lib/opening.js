export const NARRATIVE_REVISION = 'sewer-rest-v3';

export const OPENING = {
  id: 'sewer-rest-v1',
  title: '前情提要 · 原文节选',
  locationId: 'L003',
  source: { title: '我在废土世界扫垃圾', chapter: '第3章 鱼人', file: '《我在废土世界扫垃圾》完结+全番外.txt', startLine: 323, endLine: 333 },
  paragraphs: [
    '“我不行了。”过了一会儿，李念川已经满头大汗了，说：“我去喘口气。”',
    '祝宁听他声音有点痛苦，问：“怎么喘气？”',
    '李念川：“远离就行，离得越近被污染的程度越重，一般污染物，距离一千米就感觉不到了。”',
    '有点道理。',
    '污染是有距离限制的，不然孢子无法消灭，持续性无距离限制放射污染，那不是可以污染全世界？',
    '徐萌：“祝宁一起去吧。”',
    '祝宁想说自己没事，但徐萌对她打了个手势，这是让祝宁看着点李念川？',
    '剩下的孢子不多了，还剩下大概五分之一，徐萌一个人也没事。',
    '祝宁放下工具，跟着李念川走了，他们所在的地方是联邦的某个下水道，103区本来就是垃圾场，整个联邦的垃圾都要运往103区。',
    '下水道四通八达，李念川带着祝宁往下水道深处走，没有额外的照明，他们视物纯靠头盔的夜视能力。',
    '李念川越走越深，不知道的还以为这人要把自己引走杀人灭口，可能为了谨慎，走了足足两千米李念川才停下。',
  ],
  facts: ['李念川已说出身体不适，提出找地方休息', '祝宁跟随李念川进入下水道，准备陪他休息', '进入下水道时，两人没有接到探索此处的任务，也不知道这里存在什么异常'],
};

export const OPENING_CONSTRAINT = '若 player_view.opening 存在，它是已发生且不可改写的固定前情：李念川先提出身体不适、想休息，祝宁跟上，两人为休息进入下水道。不是受命调查此处，也不是预先知道这里有副本任务。前情发生在玩家行动之前，不得写成玩家本回合才决定陪同或首次提出休息。清理者职业、装备、旧任务背景不等于此处的探索任务；鱼人、车站、末班车、污染核心和症状恶化必须在后续现场证据出现后才能被角色知道。后续行动可以改变当前目的，但不能倒写两人最初进入这里的原因。';

export function isRestOpening(context) {
  return Boolean(context.opening) && (context.locationId ?? context.location?.id) === OPENING.locationId && !context.discoveredClues?.length;
}

export function contradictsRestOpening(text, context) {
  if (!isRestOpening(context)) return false;
  const value = String(text ?? '');
  // Regression guard for the obsolete shaft-side briefing, not a general OOC classifier.
  return /不急(?:着|于)?下井|还没(?:有)?下井|尚未下井|准备下井|等.{0,10}(?:休息|休整|歇).{0,10}再下井|(?:休息|休整|歇).{0,8}(?:完|好|后|再).{0,8}(?:下井|执行任务|继续任务)|(?:在|坐在|留在|退到)井口(?:警戒区|边缘|护墙)|(?:我们|两人|他们)还在地面|(?:奉命|受命).{0,12}(?:下井|调查|清理)/.test(value)
    || /(?:离开|远离).{0,8}孢子.{0,12}(?:加重|更重|恶化)/.test(value);
}

export function openingSituation(context) {
  if (!isRestOpening(context)) return null;
  return '当前位置是下水道内部的休息处，已经下井。当前目的只是休息，没有待执行的下井任务；尚未发现残存的活污染物，不知道附近仍有未被消灭的污染物。李念川只知道自己不舒服，没有证据断言离开孢子后反而加重。禁止把场景写回井口或地面，也不能说“不急着下井”“歇好再下井”。对“跟徐萌说一下吧”，自然答应转告自己不舒服、正在休息即可，不要变成任务汇报或污染分析；答应转告不等于通讯已完成。';
}
