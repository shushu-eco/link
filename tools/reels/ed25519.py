"""Ed25519 signatures in plain Python, after the reference code of RFC 8032 (section 6).

Link's updater checks with this that a release was signed with Link's own key (update.py), and
tools/package/sign.py signs a release with it. It needs nothing but hashlib, so the Python an installed
Link carries can run it. It is not written to keep a key secret from someone watching this computer
work (its timing depends on the key): it signs on the publisher's own PC and verifies in public.

    public = public_key(secret)                 secret: 32 bytes, kept by the publisher alone
    signature = sign(secret, message)           64 bytes
    verify(public, message, signature)          True or False
"""
import hashlib

p = 2**255 - 19
d = -121665 * pow(121666, p - 2, p) % p
q = 2**252 + 27742317777372353535851937790883648493
modp_sqrt_m1 = pow(2, (p - 1) // 4, p)


def sha512(s):
    return hashlib.sha512(s).digest()


def sha512_modq(s):
    return int.from_bytes(sha512(s), "little") % q


def point_add(P, Q):
    A, B = (P[1] - P[0]) * (Q[1] - Q[0]) % p, (P[1] + P[0]) * (Q[1] + Q[0]) % p
    C, D = 2 * P[3] * Q[3] * d % p, 2 * P[2] * Q[2] % p
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F % p, G * H % p, F * G % p, E * H % p)


def point_mul(s, P):
    Q = (0, 1, 1, 0)   # the neutral point
    while s > 0:
        if s & 1:
            Q = point_add(Q, P)
        P = point_add(P, P)
        s >>= 1
    return Q


def point_equal(P, Q):
    # x1 / z1 == x2 / z2  <==>  x1 * z2 == x2 * z1
    if (P[0] * Q[2] - Q[0] * P[2]) % p != 0:
        return False
    return (P[1] * Q[2] - Q[1] * P[2]) % p == 0


def recover_x(y, sign):
    if y >= p:
        return None
    x2 = (y * y - 1) * pow(d * y * y + 1, p - 2, p)
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (p + 3) // 8, p)   # a square root of x2
    if (x * x - x2) % p != 0:
        x = x * modp_sqrt_m1 % p
    if (x * x - x2) % p != 0:
        return None
    if (x & 1) != sign:
        x = p - x
    return x


g_y = 4 * pow(5, p - 2, p) % p
g_x = recover_x(g_y, 0)
G = (g_x, g_y, 1, g_x * g_y % p)


def point_compress(P):
    zinv = pow(P[2], p - 2, p)
    x, y = P[0] * zinv % p, P[1] * zinv % p
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def point_decompress(s):
    if len(s) != 32:
        return None
    y = int.from_bytes(s, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % p)


def secret_expand(secret):
    if len(secret) != 32:
        raise ValueError("a secret key is 32 bytes")
    h = sha512(secret)
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return (a, h[32:])


def public_key(secret):
    a, _ = secret_expand(secret)
    return point_compress(point_mul(a, G))


def sign(secret, message):
    a, prefix = secret_expand(secret)
    A = point_compress(point_mul(a, G))
    r = sha512_modq(prefix + message)
    Rs = point_compress(point_mul(r, G))
    h = sha512_modq(Rs + A + message)
    s = (r + h * a) % q
    return Rs + int.to_bytes(s, 32, "little")


def verify(public, message, signature):
    if len(public) != 32 or len(signature) != 64:
        return False
    A = point_decompress(public)
    if not A:
        return False
    Rs = signature[:32]
    R = point_decompress(Rs)
    if not R:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= q:
        return False
    h = sha512_modq(Rs + public + message)
    return point_equal(point_mul(s, G), point_add(R, point_mul(h, A)))
