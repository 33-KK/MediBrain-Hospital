export class GraphReviewRequiredError extends Error {
  constructor(entity: string) {
    super(`「${entity}」存在同名记录冲突，待专业复核`);
  }
}
