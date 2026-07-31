/* `server-only`는 서버 번들 밖에서 import되면 throw하도록 만들어진 패키지다.
   vitest는 node 환경에서 돌기 때문에 그대로 두면 server 모듈을 아예 로드할 수 없어,
   vitest.config.ts의 alias가 이 빈 모듈로 대체한다. */
export {};
