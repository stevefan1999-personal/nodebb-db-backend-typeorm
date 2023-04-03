CREATE DATABASE test;
GRANT ALL PRIVILEGES ON test.* TO 'root'@'%' IDENTIFIED BY 'test';
GRANT ALL PRIVILEGES ON test.* TO 'root'@'localhost' IDENTIFIED BY 'test';
