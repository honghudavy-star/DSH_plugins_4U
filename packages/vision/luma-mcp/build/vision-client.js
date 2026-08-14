/**
 * 统一的视觉模型客户端接口
 */
/**
 * 将单张或多张图片统一转换为多模态消息片段
 */
export function buildImageContent(imageDataUrl) {
    const imageUrls = Array.isArray(imageDataUrl) ? imageDataUrl : [imageDataUrl];
    return imageUrls.map((url) => ({
        type: "image_url",
        image_url: { url },
    }));
}
//# sourceMappingURL=vision-client.js.map