export class AdminListExportLoadError extends Error {
  constructor() {
    super('목록을 불러오지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.');
    this.name = 'AdminListExportLoadError';
  }
}

export class AdminListExportChangedError extends Error {
  constructor() {
    super('목록이 바뀌는 중이라 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.');
    this.name = 'AdminListExportChangedError';
  }
}
