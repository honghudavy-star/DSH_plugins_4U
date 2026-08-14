/**
 * 图片处理工具
 * 读取、验证、压缩并编码图片（本地文件、远程 URL、Data URI）
 */
/**
 * 校验图片来源（文件或 URL）
 */
export declare function validateImageSource(imageSource: string, maxSizeMB?: number): Promise<void>;
/**
 * 将图片转为 base64 Data URL
 */
export declare function imageToBase64(imagePath: string): Promise<string>;
export interface PreparedImageInput {
    imageData: string | string[];
    imageHint?: string;
}
/**
 * 将图片转为单张 base64 Data URL
 * 对文本密集场景保留更多细节
 */
export declare function imageToBase64WithOptions(imagePath: string, options?: {
    preferText?: boolean;
}): Promise<string>;
/**
 * 生成原图和多裁剪变体
 * 用于大图、长图和文本密集截图场景
 */
export declare function imageToBase64Variants(imagePath: string, options?: {
    preferText?: boolean;
    maxTiles?: number;
}): Promise<string[]>;
/**
 * 准备适合模型理解的图片输入。
 * 多裁剪场景除了返回图片列表，还会补充阅读顺序提示，帮助模型理解每张图的角色。
 */
export declare function prepareVisionImageInput(imagePath: string, options?: {
    preferText?: boolean;
    maxTiles?: number;
}): Promise<PreparedImageInput>;
//# sourceMappingURL=image-processor.d.ts.map