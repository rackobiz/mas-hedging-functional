const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Default error
    let error = {
        message: err.message || 'Internal Server Error',
        status: err.status || 500
    };

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        error.message = Object.values(err.errors).map(val => val.message).join(', ');
        error.status = 400;
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        error.message = 'Invalid token';
        error.status = 401;
    }

    if (err.name === 'TokenExpiredError') {
        error.message = 'Token expired';
        error.status = 401;
    }

    // SQLite errors
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        error.message = 'Resource already exists';
        error.status = 409;
    }

    // Don't leak error details in production
    if (process.env.NODE_ENV === 'production' && error.status === 500) {
        error.message = 'Internal Server Error';
    }

    res.status(error.status).json({
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

module.exports = { errorHandler };
