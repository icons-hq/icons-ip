-- Bind customer-visible download filenames to the validated MIME contract.
begin;
alter table private.inquiry_chat_files add constraint inquiry_chat_file_filename_extension check(
  right(lower(filename),char_length(private.inquiry_file_extension(mime_type))+1)='.'||private.inquiry_file_extension(mime_type)
  or mime_type='image/jpeg' and right(lower(filename),5)='.jpeg'
);
commit;
