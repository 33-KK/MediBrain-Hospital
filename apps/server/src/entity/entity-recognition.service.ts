import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GraphService } from '../neo4j/graph.service';

export interface RecognizedEntity {
  name: string;
  type: string;
  confidence: number;
}

export interface QuestionIntent {
  /** 问题问的维度：宜吃食物 / 忌吃食物 / 症状 / 药品 / 检查 / 并发症 / 科目 / 治疗方法 / 通用 */
  dimension: string | null;
}

const DIMENSION_KEYWORDS: Record<string, RegExp> = {
  忌吃食物: /忌吃|禁吃|不能吃|不可以吃|不宜吃|避免吃|少吃|忌口/i,
  常用药品: /吃什么药|用药|吃药|药物|药方|药[iI]n/i,
  宜吃食物: /宜吃|能吃|可以吃|适合吃|吃什么|饮食|水果|忌口.*吃/i,
  病因: /病因|原因|为什么.*(?:得|患)|怎么引起|如何引起/i,
  预防: /预防|防止|防范/i,
  治愈概率: /治愈率|治愈概率|能治好吗/i,
  治疗周期: /治疗周期|多久.*(?:治好|恢复)|治疗.*多久/i,
  易感人群: /易感|哪些人.*(?:容易|易)|好发人群/i,
  简介: /是什么病|是什么|介绍/i,
  症状: /症状|表现|感觉|不舒服|会有.*样/i,
  检查: /检查|检测|诊断|化验/i,
  并发症: /并发|引发|导致.*病|继发/i,
  所属科目: /科室|挂号|门诊|看.*科/i,
  治疗方法: /治疗|怎么治|疗法|方法/i,
};

/**
 * 医学实体剂型后缀（药品名变体，长后缀优先，剥离时按顺序尝试）
 * 例：布洛芬片 → 布洛芬；奥美拉唑肠溶胶囊 → 奥美拉唑
 */
const DRUG_FORM_SUFFIXES = [
  '缓释混悬液',
  '肠溶胶囊',
  '缓释胶囊',
  '缓释片',
  '分散片',
  '咀嚼片',
  '泡腾片',
  '肠溶片',
  '口服液',
  '混悬液',
  '注射液',
  '滴眼液',
  '滴鼻液',
  '喷雾剂',
  '气雾剂',
  '颗粒',
  '胶囊',
  '软膏',
  '凝胶',
  '滴剂',
  '片',
  '丸',
  '散',
  '糖浆',
  '栓剂',
  '乳膏',
  '溶液',
  '贴剂',
  '注射剂',
  '膜剂',
  '合剂',
  '酊剂',
  '洗剂',
  '粉针剂',
];

/** 检查类后缀：CT检查 → CT（剥离方向） / CT → CT检查（扩展方向） */
const CHECK_SUFFIXES = [
  '检查',
  '检测',
  '检验',
  '试验',
  '造影',
  '摄影',
  '扫描',
  '测定',
];

/**
 * 医学实体识别（NER）
 * - 启动时从 Neo4j 图谱加载全部实体词典（约 4.9 万）到内存
 * - 最长匹配策略识别多类型实体（疾病/药品/食物/检查/症状等）
 * - 附带问题意图分析（回答维度）
 */
@Injectable()
export class EntityRecognitionService implements OnModuleInit {
  private readonly logger = new Logger(EntityRecognitionService.name);

  /** name -> label 词典 */
  private dictionary: Map<string, string> = new Map();
  /** 变体短名 -> 词典长名（如 甲硝唑 -> 甲硝唑片），仅当短名不在词典时建立 */
  private variantMap: Map<string, string> = new Map();
  private dictionaryLoaded = false;
  private loadedAt = 0;
  private refreshing?: Promise<number>;
  private sortedNames: string[] = [];

  constructor(private readonly graph: GraphService) {}

  async onModuleInit() {
    await this.reloadDictionary().catch((err) =>
      this.logger.error(`实体词典初始加载失败: ${(err as Error).message}`),
    );
  }

  /** 重新加载实体词典（供图谱变更后手动刷新） */
  async reloadDictionary(): Promise<number> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.loadDictionary();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  /** 多副本在下一次问答时最多使用 30 秒旧词典；失败后保留上一次快照。 */
  async ensureFresh(): Promise<void> {
    if (Date.now() - this.loadedAt < 30_000) return;
    try {
      await this.reloadDictionary();
    } catch (error) {
      this.loadedAt = Date.now();
      this.logger.warn(`词典刷新失败: ${(error as Error).message}`);
    }
  }

  private async loadDictionary(): Promise<number> {
    const raw = await this.graph.loadEntityDictionary();
    // 过滤复合病名（含连接词"和/、/，"），避免"糖尿病和高血压"整段误识别
    const connector = /[和、，,]/;
    this.dictionary = new Map(
      [...raw.entries()].filter(([name]) => !connector.test(name)),
    );
    // 构建变体扩展映射：短名 + 剂型/检查后缀 = 词典词（且短名本身不在词典）→ 短名 → 词典词
    this.variantMap = new Map();
    for (const [longName] of this.dictionary) {
      for (const suffix of CHECK_SUFFIXES) {
        if (longName.endsWith(suffix)) {
          const short = longName.slice(0, -suffix.length);
          if (short.length >= 2 && !this.dictionary.has(short)) {
            this.variantMap.set(short, longName);
          }
        }
      }
      for (const suffix of DRUG_FORM_SUFFIXES) {
        if (longName.endsWith(suffix)) {
          const short = longName.slice(0, -suffix.length);
          if (short.length >= 2 && !this.dictionary.has(short)) {
            this.variantMap.set(short, longName);
          }
        }
      }
    }
    this.dictionaryLoaded = this.dictionary.size > 0;
    this.sortedNames = [...this.dictionary.keys(), ...this.variantMap.keys()]
      .filter((name) => name.length > 0)
      .sort((a, b) => b.length - a.length);
    this.loadedAt = Date.now();
    return this.dictionary.size;
  }

  /**
   * 识别问题中的医学实体。
   * 最长匹配 + 区间合并：同一文本区间只保留最长实体，避免拆词误识别。
   * 例："糖尿病和高血压" → 糖尿病 + 高血压（不产生"糖尿病和高血压"整段）。
   */
  recognize(question: string): RecognizedEntity[] {
    if (!this.dictionaryLoaded) {
      this.logger.warn('实体词典未加载，识别结果可能不完整');
    }

    // 1. 找出所有候选命中（名称→标签），按名称长度降序
    //    词典直接匹配 + 变体短名映射（甲硝唑 → 甲硝唑片）
    const names = this.sortedNames;

    interface Hit {
      start: number;
      end: number;
      name: string;
      type: string;
    }
    const candidates: Hit[] = [];
    for (const name of names) {
      let idx = question.indexOf(name);
      while (idx !== -1) {
        const canonical = this.dictionary.has(name)
          ? name
          : this.variantMap.get(name)!;
        candidates.push({
          start: idx,
          end: idx + name.length,
          name: canonical,
          type: this.dictionary.get(canonical)!,
        });
        idx = question.indexOf(name, idx + 1);
      }
    }

    // 2. 区间合并：对每个命中，若与更长命中区间重叠则丢弃
    const selected: Hit[] = [];
    const covered = new Array<boolean>(question.length).fill(false);
    for (const cand of candidates) {
      const overlaps =
        cand.start < question.length &&
        covered.slice(cand.start, cand.end).some(Boolean);
      if (overlaps) continue; // 被更长实体覆盖
      for (let i = cand.start; i < cand.end && i < question.length; i++)
        covered[i] = true;
      selected.push(cand);
    }

    const entities = selected
      .sort((a, b) => a.start - b.start)
      .map((h) => ({ name: h.name, type: h.type, confidence: 0.95 }));

    // 3. 兜底
    if (entities.length === 0) {
      return this.fallbackRecognize(question);
    }
    return entities.slice(0, 3);
  }

  /** 问题意图分析：判断问的是哪个知识维度 */
  analyzeIntent(question: string): QuestionIntent {
    if (/剂量|用量|毫克|一次吃.*(?:片|粒)|每天吃.*(?:片|粒)/.test(question))
      return { dimension: '用药剂量' };
    if (/相互作用|(?:一起|同时|合用).*(?:吃|服|用)|药物配伍/.test(question))
      return { dimension: '药物相互作用' };
    if (
      /不能.*药|药.*不能|禁用.*药|药物禁忌|不宜.*药|药.*禁忌/.test(question)
    ) {
      return { dimension: '禁忌药品' };
    }
    for (const [dimension, regex] of Object.entries(DIMENSION_KEYWORDS)) {
      if (regex.test(question)) {
        return { dimension };
      }
    }
    return { dimension: null };
  }

  /** 内置关键词兜底（词典加载失败时使用） */
  private fallbackRecognize(question: string): RecognizedEntity[] {
    const diseaseKeywords =
      /高血压|糖尿病|感冒|胃炎|肺炎|冠心病|脑卒中|哮喘|肝炎|结石|贫血|肿瘤|癌症|关节炎|失眠|痛风|过敏|咳嗽|发烧|胃溃疡|肠炎/i;
    const checkKeywords =
      /CT|核磁|X光|B超|血常规|尿常规|胃镜|肠镜|心电图|彩超/i;
    const entities: RecognizedEntity[] = [];

    const disease = question.match(diseaseKeywords);
    if (disease)
      entities.push({ name: disease[0], type: '疾病', confidence: 0.8 });

    const check = question.match(checkKeywords);
    if (check)
      entities.push({ name: check[0], type: '检查项目', confidence: 0.8 });

    return entities;
  }

  /**
   * 同义实体归一化（P2）：
   * - 剥离剂型/检查后缀 → 词典主实体（布洛芬片 → 布洛芬）
   * - 反向扩展后缀 → 词典主实体（CT → CT检查）
   * - 命中词典才归一化，否则原样返回
   */
  normalize(name: string): string {
    if (!name || this.dictionary.has(name)) return name;

    // 1. 正向扩展：短名 + 检查后缀（如 CT → CT检查）
    for (const suffix of CHECK_SUFFIXES) {
      const expanded = name + suffix;
      if (this.dictionary.has(expanded)) return expanded;
    }
    // 2. 正向扩展：短名 + 剂型后缀（如 甲硝唑 → 甲硝唑片）
    for (const suffix of DRUG_FORM_SUFFIXES) {
      const expanded = name + suffix;
      if (this.dictionary.has(expanded)) return expanded;
    }
    // 3. 反向剥离：长名 - 检查后缀（如 CT检查 → CT，仅当短名在词典）
    for (const suffix of CHECK_SUFFIXES) {
      if (name.endsWith(suffix)) {
        const stripped = name.slice(0, -suffix.length);
        if (this.dictionary.has(stripped)) return stripped;
      }
    }
    // 4. 反向剥离：长名 - 剂型后缀（如 布洛芬片 → 布洛芬）
    for (const suffix of DRUG_FORM_SUFFIXES) {
      if (name.endsWith(suffix)) {
        const stripped = name.slice(0, -suffix.length);
        if (this.dictionary.has(stripped)) return stripped;
      }
    }
    return name;
  }

  /**
   * 向量候选去重（P2）：按归一化名合并同义实体，保留最高分。
   * 例：[布洛芬 0.82, 布洛芬片 0.79] → [布洛芬 0.82]
   */
  dedupeCandidates<T extends { name: string; score: number }>(
    candidates: T[],
  ): T[] {
    const seen = new Map<string, T>();
    for (const cand of candidates) {
      const key = this.normalize(cand.name);
      const existing = seen.get(key);
      if (!existing || cand.score > existing.score) {
        seen.set(key, { ...cand, name: key });
      }
    }
    return [...seen.values()].sort((a, b) => b.score - a.score);
  }
}
