/**
 * 默认基础视觉提示词
 * 相当于图片理解的轻型 system prompt
 *
 * 设计目标：
 * - 激发原生多模态模型的视觉理解能力
 * - 针对开发者场景优化输出质量
 * - 不限制模型的自然推理和判断
 */
export declare const DEFAULT_BASE_VISION_PROMPT: string;
/**
 * 文本密集场景的正则模式
 * 用于代码截图、OCR、UI 长图等场景的保真处理
 */
export declare const TEXT_HEAVY_PROMPT_PATTERN: RegExp;
/** Package version mirrored for MCP server metadata */
export declare const PACKAGE_VERSION = "1.6.1";
//# sourceMappingURL=constants.d.ts.map