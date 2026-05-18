#!/usr/bin/env python3
"""Remove bcryptprimitives.dll from PE import table by compacting descriptors."""
import struct
import sys

def patch_exe(exe_path):
    with open(exe_path, "rb") as f:
        data = bytearray(f.read())

    pe_off = struct.unpack_from("<I", data, 0x3c)[0]
    num_sections = struct.unpack_from("<H", data, pe_off + 6)[0]
    opt_header_size = struct.unpack_from("<H", data, pe_off + 20)[0]
    sec_off = pe_off + 4 + 20 + opt_header_size
    opt_off = pe_off + 24
    is_pe64 = (struct.unpack_from("<H", data, opt_off)[0] == 0x20b)
    dd_off = opt_off + (112 if is_pe64 else 96)

    import_rva = struct.unpack_from("<I", data, dd_off + 8)[0]
    import_size = struct.unpack_from("<I", data, dd_off + 12)[0]

    def rva_to_off(rva):
        for i in range(num_sections):
            s_off = sec_off + i * 40
            s_raddr = struct.unpack_from("<I", data, s_off + 12)[0]
            s_vsize = struct.unpack_from("<I", data, s_off + 8)[0]
            s_rawaddr = struct.unpack_from("<I", data, s_off + 20)[0]
            if rva >= s_raddr and rva < s_raddr + s_vsize:
                return rva - s_raddr + s_rawaddr
        return None

    base_off = rva_to_off(import_rva)
    if base_off is None:
        print("Error: import directory not found")
        return False

    desc_size = 20

    # Step 1: Walk all descriptors and find bcryptprimitives.dll
    descriptors = []
    idx = base_off
    while idx < base_off + import_size - desc_size + 1:
        name_rva = struct.unpack_from("<I", data, idx + 12)[0]
        if name_rva == 0:
            break
        orig_thunk = struct.unpack_from("<I", data, idx)[0]
        first_thunk = struct.unpack_from("<I", data, idx + 16)[0]
        dll_off = rva_to_off(name_rva)
        dll_name = ""
        if dll_off:
            dll_name = data[dll_off:dll_off+64].split(b"\x00")[0].decode("ascii", errors="replace")
        descriptors.append({
            'off': idx,
            'orig_thunk': orig_thunk,
            'name_rva': name_rva,
            'first_thunk': first_thunk,
            'dll_name': dll_name,
        })
        idx += desc_size

    num_desc = len(descriptors)
    print(f"Found {num_desc} descriptors in import table")

    bcrypt_idx = None
    for i, d in enumerate(descriptors):
        if d['dll_name'] == "bcryptprimitives.dll":
            bcrypt_idx = i
            break

    if bcrypt_idx is None:
        print("bcryptprimitives.dll not found in import table")
        return True

    print(f"Removing bcryptprimitives.dll at index {bcrypt_idx}")

    # Step 2: Shift all descriptors after bcrypt down by one slot
    # We need to copy descriptors[bcrypt_idx+1:] to positions starting at bcrypt_idx
    # Each descriptor is desc_size bytes
    shift_start = base_off + (bcrypt_idx + 1) * desc_size
    shift_end = base_off + num_desc * desc_size
    shift_amount = shift_end - shift_start

    if shift_amount > 0:
        # Copy descriptors down
        data[shift_start - desc_size:shift_start - desc_size + shift_amount] = \
            data[shift_start:shift_start + shift_amount]

    # Step 3: Zero the last descriptor (was the null terminator, now at num_desc-1 position)
    last_desc_off = base_off + (num_desc - 1) * desc_size
    for i in range(desc_size):
        data[last_desc_off + i] = 0

    # Step 4: Update import directory size in PE header
    new_import_size = num_desc * desc_size
    struct.pack_into("<I", data, dd_off + 12, new_import_size)

    # Step 5: Zero the bcryptprimitives DLL name string and its ILT/IAT entries
    bdesc = descriptors[bcrypt_idx]
    # Zero DLL name string
    dll_off = rva_to_off(bdesc['name_rva'])
    if dll_off:
        end = dll_off
        while end < len(data) and data[end] != 0:
            end += 1
        for j in range(dll_off, end + 1):
            data[j] = 0
    # Zero ILT entries
    for thunk_rva in [bdesc['orig_thunk'], bdesc['first_thunk']]:
        if thunk_rva:
            thunk_off = rva_to_off(thunk_rva)
            if thunk_off:
                fi = 0
                while True:
                    entry = struct.unpack_from("<Q", data, thunk_off + fi * 8)[0]
                    if entry == 0:
                        break
                    if not (entry & (1 << 63)):
                        fn_rva = entry & 0xFFFFFFFF
                        fn_off = rva_to_off(fn_rva)
                        if fn_off:
                            end = fn_off + 2
                            while end < len(data) and data[end] != 0:
                                end += 1
                            for j in range(fn_off, end + 1):
                                data[j] = 0
                    struct.pack_into("<Q", data, thunk_off + fi * 8, 0)
                    fi += 1

    with open(exe_path, "wb") as f:
        f.write(data)
    print("Successfully removed bcryptprimitives.dll from import table")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: remove_bcrypt.py <exe_path>")
        sys.exit(1)
    patch_exe(sys.argv[1])
