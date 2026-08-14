/**
 * Optional task_type for image_understand (single tool, backward compatible).
 * When omitted, behavior matches pre-1.6: prompt heuristic + default base vision prompt.
 */
export declare const TASK_TYPES: readonly ["auto", "general", "ocr", "ui", "debug", "describe"];
export type TaskType = (typeof TASK_TYPES)[number];
/**
 * Resolve effective task for preprocessing and prompt shaping.
 */
export declare function resolveTaskType(taskType: TaskType | undefined, userPrompt: string): Exclude<TaskType, "auto">;
/**
 * Whether preprocessing should prefer text fidelity.
 */
export declare function shouldPreferTextForTask(effective: Exclude<TaskType, "auto">, userPrompt: string): boolean;
/**
 * OCR-like tasks: prefer single high-fidelity image over multi-crop by default.
 */
export declare function shouldDisableMultiCropForTask(effective: Exclude<TaskType, "auto">): boolean;
/**
 * Append task-specific guidance after base prompt + user task.
 */
export declare function buildTaskPromptAddon(effective: Exclude<TaskType, "auto">): string | undefined;
//# sourceMappingURL=task-types.d.ts.map