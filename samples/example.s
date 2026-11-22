// Sample AMD GCN / CDNA / RDNA Assembly Kernel
/* Multi-line block comment:
   Demonstrates syntax highlighting, hover docs, and Go-to-Definition.
   .set ignored_in_comment, s99
   ignored_label_in_comment:
*/

.amdgcn_target "amdgcn-amd-amdhsa--gfx942"
.text
.globl vector_add_mfma_kernel
.p2align 8
.type vector_add_mfma_kernel,@function

; SGPR / VGPR / AGPR alias definitions
.set s_base, 4
.equ s_kernarg, s[0:1]
.equiv s_desc, s[s_base:s_base+3]
my_vreg = 2
#define acc_reg 0
.set v_addr, v[my_vreg:my_vreg+1]
.set a_accum, a[acc_reg:acc_reg+3]

.macro LOAD_DATA dst, base, off
    s_load_dwordx2 \dst, \base, \off glc
.endm

vector_add_mfma_kernel:
    // Load kernel arguments
    s_load_b64 s[s_base:s_base+1], s_kernarg, 0x0
    s_load_dword s6, s_kernarg, 0x10
    s_waitcnt lgkmcnt(0)

    // Initialize loop counter and vector registers
    s_mov_b32 s7, 0
    v_mov_b32_e32 v0, 0
    v_add_f32_e64 v1, v[my_vreg], v3 clamp omod:2
    V_MUL_F32 v4, v1, 2.5

.L_loop:
    s_cmp_lt_u32 s7, s6
    s_cbranch_scc0 .L_done

    global_load_dword v5, v_addr, off offset:16 glc slc
    s_waitcnt vmcnt(0)

    ds_read_b32 v6, v0 offset:0
    v_mfma_f32_16x16x16_f16 a[acc_reg:acc_reg+3], v[0:1], v[2:3], a_accum

    s_add_u32 s7, s7, 1
    s_branch .L_loop

    // Redefinition test
    .set s_base, 8
    s_mov_b32 s[s_base], 1

.L_done:
    s_endpgm
.L_func_end:
    .size vector_add_mfma_kernel, .L_func_end - vector_add_mfma_kernel

.rodata
.p2align 6
.amdhsa_kernel vector_add_mfma_kernel
    .amdhsa_group_segment_fixed_size 0
    .amdhsa_private_segment_fixed_size 0
    .amdhsa_next_free_vgpr 32
    .amdhsa_next_free_sgpr 16
.end_amdhsa_kernel
