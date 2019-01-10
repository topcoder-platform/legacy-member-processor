delete from informixoltp:coder_image_xref where coder_id=40309264;
delete from informixoltp:image where link in ('https://topcoder-dev-media.s3.amazonaws.com/member/profile/pic1.png', 'https://topcoder-dev-media.s3.amazonaws.com/member/profile/amy_admin-1538006300716.jpeg','https://UPDATED-URL');
delete from informixoltp:coder where coder_id=40309264;
delete from user_address_xref where user_id=40309264;
delete from address where city in ('Karditsa', 'updated city');
delete from email where user_id=40309264;
delete from user where user_id=40309264;
