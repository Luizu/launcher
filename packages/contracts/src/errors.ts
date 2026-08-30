export interface ApiErrorResponse {
  status: "error";
  code: string;
  message: string;
  nextAction: string;
}
