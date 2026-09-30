const errorHandler = require('../src/middleware/errorHandler');
const notFound = require('../src/middleware/notfound');
const { createError } = require('../src/utils/errors');

function responseMock() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('error response helpers', () => {
  afterEach(() => jest.restoreAllMocks());

  it('creates an error object with code and message', () => {
    expect(createError('INVALID_BODY', 'Validation failed')).toEqual({
      code: 'INVALID_BODY',
      message: 'Validation failed',
    });
  });

  it('includes details when supplied to createError', () => {
    const details = [{ field: 'name', message: 'Required' }];
    expect(createError('INVALID_BODY', 'Validation failed', details)).toEqual({
      code: 'INVALID_BODY',
      message: 'Validation failed',
      details,
    });
  });

  it('does not include details when they are undefined', () => {
    expect(createError('NOT_FOUND', 'Missing resource')).not.toHaveProperty('details');
  });

  it('returns the error status, message, and code from errorHandler', () => {
    const res = responseMock();
    const err = { status: 409, message: 'Already exists', code: 'DUPLICATE' };
    jest.spyOn(console, 'error').mockImplementation(() => {});

    errorHandler(err, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'Already exists', code: 'DUPLICATE' });
    expect(console.error).toHaveBeenCalledWith(err);
  });

  it('uses server error defaults when error fields are absent', () => {
    const res = responseMock();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    errorHandler({}, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error', code: 'SERVER_ERROR' });
  });

  it('returns a JSON not-found response including the requested path', () => {
    const res = responseMock();

    notFound({ originalUrl: '/unknown/path?x=1' }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Resource not found',
      code: 'NOT_FOUND',
      path: '/unknown/path?x=1',
    });
  });
});
