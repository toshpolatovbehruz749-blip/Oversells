/** An error that is safe to show to API clients. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const tooLarge = (code: string, message: string) => new AppError(413, code, message);
export const forbidden = (code: string, message: string) => new AppError(403, code, message);
