import { bootstrapApplication } from "./app/bootstrap";
import { installGlobalErrorHandlers } from "./app/globalErrorHandlers";

installGlobalErrorHandlers();
bootstrapApplication();
