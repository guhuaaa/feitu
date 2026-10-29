// Editorial rules derived from chapter_0003/0004 and character_voice_profiles.
// These are adaptation guidance, not additional facts or future plot knowledge.
export const NARRATIVE_CONSTRAINT = `剧情正文、事件标题、正文中的对白和人物动作都必须遵守原文的人物与叙事边界，不只单独的角色聊天需要防止 OOC。
文风：第三人称限知，贴近当前行动角色的现场感知。使用具体、直白的词和长短交错的短段落，让动作、观察、简短问答推动情节；紧张来自已经出现的反常细节。可有少量日常化比较、克制的反问或冷幽默，不要每段强行吐槽，不堆砌阴冷意象、抒情比喻、电影镜头或章末悬念。保留这些一般叙事特点，以原创措辞续写，不复刻原文句子。
人物：祝宁有战斗经验，但此时是清理工作的新人，不熟悉的术语与程序会直接问；她会警惕、核验，也会自然反问，不能写成全知的资深队长、没有情绪的机器或只会温柔照顾人的保姆。照应李念川与提防他受污染失控可以同时成立。李念川年轻、性急、说话口语化，会抱怨和低估自己的不适，懂部分工作常识但不是污染专家；不能把他固定写成沉默服从的跟班或只会喘气的道具。两人的信任须随已经发生的协作发展，不提前使用后期依赖、亲昵称呼、亲密关系或终局能力。徐萌简短务实，承担队长责任，只知道已经上报的信息，不自动知道地下发生的一切。
行动：只展开玩家已经授权的动作及其直接反应，不擅自替玩家拒绝同伴、决定领路、继续深入、放弃上报或接受任务。人物可以有基于可见证据的一闪而过的疑问，不能替玩家作出新的内心决定；不同时进入其他人物内心。玩家明确选择偏离原路线时可以形成分支，不能为了复刻原剧情撤销其选择。
事实：角色档案、原文参照和旧生成段落不是本回合的新事实授权。地点外观相似不等于空间循环；安静不等于通讯中断；已知不适不等于本回合必然加重。不得为凑篇幅新增这些异常，也不能提前泄露鱼人、列车、核心或隐藏机制。体征可以保持不变，不要求每回合描写喘息、流汗或恶化。额外照明、手电筒开关、防护装备状态都要有当前依据，不能默认头灯扫出光束；原文休息前的通行主要依靠头盔夜视。
正文与审计分开：story_segment 是自然叙事，不写“状态写入”“因果链”“运行时”“分支提交”等后台用语，不让人物念系统摘要。event_text 负责短摘要。事实不足时宁可短写，不用虚构危险填满字数。
输出前逐项复核标题、摘要和正文：文风、人物动机与关系阶段、各自知情范围、玩家行动授权、当前事实连续性。发现不符先改写，再输出 narrative_check，其中 style_consistent、character_consistent、knowledge_bounded、player_agency_preserved、facts_bounded 必须全部为 true；无法满足时返回 false，由本地流程接管。自检只用于质量门禁，不授予任何世界状态变更权限。`;

export const NARRATIVE_CHECK_KEYS = ['style_consistent', 'character_consistent', 'knowledge_bounded', 'player_agency_preserved', 'facts_bounded'];

export function passesNarrativeCheck(event) {
  return NARRATIVE_CHECK_KEYS.every((key) => event?.narrative_check?.[key] === true);
}

export const NARRATIVE_REFERENCE = {
  sources: ['原文第3章《鱼人》：下水道清理与休息前情', '原文第4章《污染区域》：清理新人询问规则与同伴协作', 'character_voice_profiles.json：人物表达与知情边界'],
  scope: '仅提炼叙事特点和人物阶段；后续原文事件不自动成为当前已知事实。',
  observations: [
    '叙述紧贴动作与朴素疑问，日常化联想能短暂缓冲恐怖，随后回到眼前问题。',
    '祝宁对战斗的熟练与对清理规则的陌生并存；谨慎不等于老练官腔。',
    '李念川会不耐烦、辩解或质疑，信任需要现场证据；身体不适没有抹去他的自主反应。',
  ],
};
