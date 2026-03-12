export {
  createPlayerMail,
  deleteMailThreadForPlayer,
  getMailboxData,
  getUnreadMailCount,
  markMailThreadRead,
  replyToMailThread,
  searchMailRecipients,
  sendSystemMail,
} from "./service";
export {
  mailboxQuerySchema,
  mailRecipientSearchSchema,
  markMailThreadReadSchema,
  replyMailSchema,
  sendMailSchema,
} from "./validations";
export type {
  MailboxQueryInput,
  MailRecipientSearchInput,
  MarkMailThreadReadInput,
  ReplyMailInput,
  SendMailInput,
} from "./validations";
export type {
  MailCounterpart,
  MailMessage,
  MailRecipientPreview,
  MailSenderType,
  MailThreadDetail,
  MailThreadKind,
  MailThreadPreview,
  MailboxData,
} from "./types";
