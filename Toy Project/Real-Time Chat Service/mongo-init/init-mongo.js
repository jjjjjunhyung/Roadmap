// MongoDB 초기화 스크립트
print('=== MongoDB 초기화 시작 ===');

// chatdb 데이터베이스 사용
db = db.getSiblingDB('chatdb');

// 사용자 컬렉션 생성 및 인덱스 설정
db.createCollection('users');
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "username": 1 }, { unique: true });

// 메시지 컬렉션 생성 및 인덱스 설정
db.createCollection('messages');
db.messages.createIndex({ "room": 1, "createdAt": -1 });
db.messages.createIndex({ "sender": 1 });

// 방 컬렉션 생성 및 인덱스 설정
db.createCollection('rooms');
db.rooms.createIndex({ "name": 1 });
db.rooms.createIndex({ "type": 1 });
db.rooms.createIndex({ "members": 1 });

// 기본 공개 방 생성
db.rooms.insertOne({
  name: "일반 채팅",
  description: "모든 사용자가 참여할 수 있는 일반 채팅방입니다.",
  type: "public",
  owner: null,
  members: [],
  active: true,
  createdAt: new Date(),
  updatedAt: new Date()
});

db.rooms.insertOne({
  name: "개발 토론",
  description: "개발 관련 토론을 위한 채팅방입니다.",
  type: "public",
  owner: null,
  members: [],
  active: true,
  createdAt: new Date(),
  updatedAt: new Date()
});

db.rooms.insertOne({
  name: "자유 게시판",
  description: "자유롭게 이야기할 수 있는 공간입니다.",
  type: "public",
  owner: null,
  members: [],
  active: true,
  createdAt: new Date(),
  updatedAt: new Date()
});

print('=== MongoDB 초기화 완료 ===');
print('생성된 컬렉션:');
db.getCollectionNames().forEach(function(collection) {
  print('- ' + collection);
});

print('인덱스 정보:');
print('Users 인덱스:', db.users.getIndexes());
print('Messages 인덱스:', db.messages.getIndexes());
print('Rooms 인덱스:', db.rooms.getIndexes());