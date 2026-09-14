// Small dense linear algebra. Matrices are row-major Float64Array with the
// dimensions passed alongside. Everything here works on matrices of at most
// a few tens of rows, so clarity is worth more than cleverness.
(function (global) {
  "use strict";

  function zeros(n) { return new Float64Array(n); }

  // Cholesky factor L of a symmetric positive definite A (n by n).
  // Returns null when A is not positive definite.
  function chol(A, n) {
    var L = zeros(n * n), i, j, k, s;
    for (i = 0; i < n; i++) {
      for (j = 0; j <= i; j++) {
        s = A[i * n + j];
        for (k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) {
          if (s <= 0) return null;
          L[i * n + i] = Math.sqrt(s);
        } else {
          L[i * n + j] = s / L[j * n + j];
        }
      }
    }
    return L;
  }

  // Solve A x = b given the Cholesky factor of A.
  function cholSolve(L, n, b) {
    var y = zeros(n), x = zeros(n), i, k, s;
    for (i = 0; i < n; i++) {
      s = b[i];
      for (k = 0; k < i; k++) s -= L[i * n + k] * y[k];
      y[i] = s / L[i * n + i];
    }
    for (i = n - 1; i >= 0; i--) {
      s = y[i];
      for (k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
      x[i] = s / L[i * n + i];
    }
    return x;
  }

  // Solve A X = B for X, with B given as m columns (n by m, row-major).
  function cholSolveMat(L, n, B, m) {
    var X = zeros(n * m), col = zeros(n), j, i, x;
    for (j = 0; j < m; j++) {
      for (i = 0; i < n; i++) col[i] = B[i * m + j];
      x = cholSolve(L, n, col);
      for (i = 0; i < n; i++) X[i * m + j] = x[i];
    }
    return X;
  }

  function logDet(L, n) {
    var s = 0, i;
    for (i = 0; i < n; i++) s += Math.log(L[i * n + i]);
    return 2 * s;
  }

  // C = A * B, A is (ar by ac), B is (ac by bc)
  function matmul(A, ar, ac, B, bc) {
    var C = zeros(ar * bc), i, j, k, s;
    for (i = 0; i < ar; i++) {
      for (j = 0; j < bc; j++) {
        s = 0;
        for (k = 0; k < ac; k++) s += A[i * ac + k] * B[k * bc + j];
        C[i * bc + j] = s;
      }
    }
    return C;
  }

  // C = A * B', A is (ar by ac), B is (br by ac)
  function matmulT(A, ar, ac, B, br) {
    var C = zeros(ar * br), i, j, k, s;
    for (i = 0; i < ar; i++) {
      for (j = 0; j < br; j++) {
        s = 0;
        for (k = 0; k < ac; k++) s += A[i * ac + k] * B[j * ac + k];
        C[i * br + j] = s;
      }
    }
    return C;
  }

  // y = A * x
  function matvec(A, r, c, x) {
    var y = zeros(r), i, k, s;
    for (i = 0; i < r; i++) {
      s = 0;
      for (k = 0; k < c; k++) s += A[i * c + k] * x[k];
      y[i] = s;
    }
    return y;
  }

  function dot(a, b, n, ao, bo) {
    var s = 0, i;
    ao = ao || 0; bo = bo || 0;
    for (i = 0; i < n; i++) s += a[ao + i] * b[bo + i];
    return s;
  }

  // Abramowitz and Stegun 7.1.26. The Python reference uses the same form,
  // so the two agree to well past four decimals.
  function erf(x) {
    var s = x < 0 ? -1 : 1, t, y;
    x = Math.abs(x);
    t = 1 / (1 + 0.3275911 * x);
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }

  function normPdf(z) { return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI); }
  function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function gelu(x) { return x * 0.5 * (1 + erf(x / Math.SQRT2)); }

  global.LA = {
    zeros: zeros, chol: chol, cholSolve: cholSolve,
    cholSolveMat: cholSolveMat, logDet: logDet, matmul: matmul,
    matmulT: matmulT, matvec: matvec, dot: dot, erf: erf,
    normPdf: normPdf, normCdf: normCdf, gelu: gelu
  };
})(window);
