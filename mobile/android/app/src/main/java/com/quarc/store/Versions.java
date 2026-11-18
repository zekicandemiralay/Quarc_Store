package com.quarc.store;

/** Numeric version comparison matching the web app: 1.0.10 > 1.0.9; a leading "v" and suffixes are ignored. */
final class Versions {
    private Versions() {}

    static int compare(String a, String b) {
        String[] pa = clean(a).split("[.+-]");
        String[] pb = clean(b).split("[.+-]");
        int n = Math.max(3, Math.max(pa.length, pb.length));
        for (int i = 0; i < n; i++) {
            int x = i < pa.length ? num(pa[i]) : 0;
            int y = i < pb.length ? num(pb[i]) : 0;
            if (x != y) return x > y ? 1 : -1;
        }
        return 0;
    }

    private static String clean(String v) {
        if (v == null) return "0";
        return v.startsWith("v") || v.startsWith("V") ? v.substring(1) : v;
    }

    private static int num(String s) {
        int end = 0;
        while (end < s.length() && Character.isDigit(s.charAt(end))) end++;
        if (end == 0) return 0;
        try {
            return Integer.parseInt(s.substring(0, Math.min(end, 9)));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
